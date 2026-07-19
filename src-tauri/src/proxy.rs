//! Servidor local same-origin en el puerto 9527.
//!
//! Hace dos cosas:
//! 1. Sirve los estáticos (frontend) usando el `asset_resolver` de Tauri
//!    (mismo mecanismo que usaba `tauri-plugin-localhost`).
//! 2. Reverse-proxyea `/api/*` (HTTP + WebSocket upgrade) a
//!    `https://api.vorak.app/api/*`.
//!
//! Al servir frontend y API en el mismo origen (`http://localhost:9527`),
//! la cookie HttpOnly del login es *first-party*, por lo que WebKitGTK
//! (que bloquea cookies third-party) la envía en el handshake del WS.
//! El token JWT jamás toca JavaScript.
//!
//! Las cabeceras `Set-Cookie` del upstream se reescriben para quitar
//! `Domain=` (que sería rechazado al venir de localhost), `Secure`
//! (la cookie no se almacenaría sobre http) y rebajar `SameSite=None`
//! a `SameSite=Lax` (None sin Secure es inválido).

use axum::{
    body::{to_bytes, Body},
    extract::{FromRequestParts, Request, State},
    http::{
        header::{self, COOKIE, HOST, SET_COOKIE},
        HeaderMap, HeaderName, HeaderValue, StatusCode,
    },
    response::{IntoResponse, Response},
    routing::any,
    Router,
};
use futures_util::{SinkExt, StreamExt};
use rustls::{ClientConfig, RootCertStore};
use std::sync::Arc;
use tokio_rustls::TlsConnector;
use tokio::io::AsyncWriteExt;
use tokio_tungstenite::tungstenite::{
    self,
    handshake::client::generate_key,
    protocol::{frame::coding::CloseCode as TsCloseCode, CloseFrame as TsCloseFrame, Role},
};

const PORT: u16 = 9527;

#[derive(Clone)]
struct ProxyState {
    upstream_origin: String, // https://api.vorak.app
    upstream_host: String,   // api.vorak.app
    http_client: reqwest::Client,
    app_handle: tauri::AppHandle,
}

/// Inicia el servidor proxy en segundo plano dentro del runtime de Tauri.
///
/// El `bind` del socket es **síncrono** (std) para garantizar que el puerto 9527
/// está reservado antes de que la ventana principal intente cargar
/// `http://localhost:9527/`. La conversión a `tokio::net::TcpListener` se
/// difiere al `spawn` asíncrono de Tauri, donde ya hay reactor de Tokio.
pub fn spawn(app_handle: tauri::AppHandle, upstream_base_url: &str) {
    let (origin, host) = parse_upstream(upstream_base_url);

    // Bind síncrono: reserva el puerto inmediatamente. Si falla, abortamos
    // antes de crear la ventana.
    let std_listener = match std::net::TcpListener::bind(("127.0.0.1", PORT)) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("❌ No se pudo enlazar 127.0.0.1:{PORT}: {e}");
            return;
        }
    };
    // El puerto ya está nuestro. Marcamos no-bloqueante para que Tokio
    // pueda hacer polling sin bloquear el event loop.
    let _ = std_listener.set_nonblocking(true);

    // Construcción de estado (no necesita reactor).
    let http_client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .expect("no se pudo construir el cliente HTTP del proxy");

    let state = ProxyState {
        upstream_origin: origin,
        upstream_host: host,
        http_client,
        app_handle,
    };

    let app = Router::new()
        .route("/api", any(proxy_handler))
        .route("/api/{*rest}", any(proxy_handler))
        .fallback(static_handler)
        .with_state(state);

    // Tauri::async_runtime::spawn ejecuta en el runtime de Tokio de Tauri,
    // que ya está entrado (entered). from_std no falla aquí.
    tauri::async_runtime::spawn(async move {
        let listener = match tokio::net::TcpListener::from_std(std_listener) {
            Ok(l) => l,
            Err(e) => {
                eprintln!("❌ proxy: from_std falló: {e}");
                return;
            }
        };
        println!("✅ Proxy same-origin escuchando en http://localhost:{PORT}");
        if let Err(e) = axum::serve(listener, app.into_make_service()).await {
            eprintln!("❌ Error en servidor proxy: {e}");
        }
    });
}

fn parse_upstream(base_url: &str) -> (String, String) {
    // base_url típico: "https://api.vorak.app/api"
    let (scheme, rest) = base_url
        .split_once("://")
        .unwrap_or(("https", base_url.trim_start_matches("https://")));
    let host = rest.split('/').next().unwrap_or(rest);
    let origin = format!("{scheme}://{host}");
    (origin, host.to_string())
}

// -------------------- Ruta estática --------------------

async fn static_handler(State(state): State<ProxyState>, req: Request) -> Response {
    // Sirve los assets embebidos de Tauri (frontendDist) por su ruta.
    let path = req.uri().path();
    let asset_path = path.trim_start_matches('/').to_string();
    let asset_path = if asset_path.is_empty() { "index.html".to_string() } else { asset_path };

    match state.app_handle.asset_resolver().get(asset_path) {
        Some(asset) => {
            let mut builder = Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, asset.mime_type())
                .header(header::CACHE_CONTROL, "no-cache");
            if let Some(csp) = asset.csp_header() {
                builder = builder.header(header::CONTENT_SECURITY_POLICY, csp);
            }
            builder
                .body(Body::from(asset.bytes().to_vec()))
                .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
        }
        None => {
            // Fallback a index.html para rutas SPA (por si acaso).
            match state.app_handle.asset_resolver().get("index.html".to_string()) {
                Some(asset) => Response::builder()
                    .status(StatusCode::OK)
                    .header(header::CONTENT_TYPE, asset.mime_type())
                    .header(header::CACHE_CONTROL, "no-cache")
                    .body(Body::from(asset.bytes().to_vec()))
                    .unwrap_or_else(|_| StatusCode::NOT_FOUND.into_response()),
                None => StatusCode::NOT_FOUND.into_response(),
            }
        }
    }
}

// -------------------- Ruta /api (HTTP + WS) --------------------

async fn proxy_handler(
    State(state): State<ProxyState>,
    req: Request,
) -> Response {
    let path_query = req
        .uri()
        .path_and_query()
        .map(|s| s.to_string())
        .unwrap_or_default();
    let cookie = req.headers().get(COOKIE).cloned();

    let is_ws_upgrade = req.headers().get("upgrade")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.eq_ignore_ascii_case("websocket"))
        .unwrap_or(false);

    if is_ws_upgrade {
        let (mut parts, body) = req.into_parts();
        match axum::extract::ws::WebSocketUpgrade::from_request_parts(&mut parts, &state).await {
            Ok(upgrade) => {
                let upstream_origin = state.upstream_origin.clone();
                upgrade.on_upgrade(move |socket| forward_ws(socket, upstream_origin, path_query, cookie))
            }
            Err(_) => {
                let req = Request::from_parts(parts, body);
                proxy_http(req, &state).await
            }
        }
    } else {
        proxy_http(req, &state).await
    }
}

async fn proxy_http(req: Request, state: &ProxyState) -> Response {
    let (parts, body) = req.into_parts();
    let path_query = parts
        .uri
        .path_and_query()
        .map(|s| s.as_str())
        .unwrap_or("");
    let url = format!("{}{}", state.upstream_origin, path_query);

    let method = match reqwest::Method::from_bytes(parts.method.as_str().as_bytes()) {
        Ok(m) => m,
        Err(_) => return StatusCode::BAD_REQUEST.into_response(),
    };

    let body_bytes = match to_bytes(body, 16 * 1024 * 1024).await {
        Ok(b) => b,
        Err(e) => {
            eprintln!("❌ Proxy: error leyendo body: {e}");
            return StatusCode::BAD_REQUEST.into_response();
        }
    };

    let mut headers = parts.headers;
    strip_hop_by_hop(&mut headers);
    if let Ok(hv) = HeaderValue::from_str(&state.upstream_host) {
        headers.insert(HOST, hv);
    }

    let result = state
        .http_client
        .request(method, &url)
        .headers(headers)
        .body(body_bytes)
        .send()
        .await;

    match result {
        Ok(resp) => build_response(resp).await,
        Err(e) => {
            eprintln!("❌ Proxy HTTP error ({url}): {e}");
            StatusCode::BAD_GATEWAY.into_response()
        }
    }
}

async fn build_response(resp: reqwest::Response) -> Response {
    let status = resp.status();
    let mut headers = resp.headers().clone();
    strip_hop_by_hop(&mut headers);
    rewrite_set_cookie(&mut headers);

    let bytes = match resp.bytes().await {
        Ok(b) => b,
        Err(e) => {
            eprintln!("❌ Proxy: error leyendo respuesta upstream: {e}");
            return StatusCode::BAD_GATEWAY.into_response();
        }
    };

    let mut builder = Response::builder().status(status);
    *builder.headers_mut().unwrap() = headers;
    builder
        .body(Body::from(bytes))
        .unwrap_or_else(|_| StatusCode::BAD_GATEWAY.into_response())
}

// -------------------- Puente WebSocket --------------------

async fn forward_ws(
    socket: axum::extract::ws::WebSocket,
    upstream_origin: String,
    path_query: String,
    cookie: Option<HeaderValue>,
) {
    let upstream_host = upstream_origin
        .strip_prefix("https://")
        .or_else(|| upstream_origin.strip_prefix("http://"))
        .unwrap_or(&upstream_origin)
        .to_string();

    // TCP + TLS con ALPN forzado a HTTP/1.1. Cloudflare Workers NO envía
    // la respuesta 101 Switching Protocols — los frames WebSocket llegan
    // directamente. Escribimos el handshake manual y usamos from_raw_socket
    // para evitar que tungstenite intente parsear la respuesta HTTP.
    let tcp = match tokio::net::TcpStream::connect((upstream_host.as_str(), 443)).await {
        Ok(s) => s,
        Err(e) => {
            eprintln!("❌ WS proxy: TCP falló a {upstream_host}:443: {e}");
            return;
        }
    };

    let mut root_store = RootCertStore::empty();
    root_store.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());

    let mut tls_config = ClientConfig::builder()
        .with_root_certificates(root_store)
        .with_no_client_auth();
    tls_config.alpn_protocols = vec![b"http/1.1".to_vec()];
    let tls_config = Arc::new(tls_config);

    let tls_connector = TlsConnector::from(Arc::clone(&tls_config));
    let domain = match rustls::pki_types::ServerName::try_from(upstream_host.clone()) {
        Ok(d) => d,
        Err(e) => {
            eprintln!("❌ WS proxy: ServerName inválido ({upstream_host}): {e}");
            return;
        }
    };

    let mut tls_stream = match tls_connector.connect(domain, tcp).await {
        Ok(s) => s,
        Err(e) => {
            eprintln!("❌ WS proxy: TLS falló: {e}");
            return;
        }
    };

    // Handshake HTTP/1.1 manual: Cloudflare recibe la petición y establece
    // el túnel WebSocket, pero el Worker omite la respuesta 101.
    let key = generate_key();
    let mut req = format!(
        "GET {path_query} HTTP/1.1\r\n\
         Host: {upstream_host}\r\n\
         Origin: http://localhost:9527\r\n\
         Upgrade: websocket\r\n\
         Connection: Upgrade\r\n\
         Sec-WebSocket-Key: {key}\r\n\
         Sec-WebSocket-Version: 13\r\n"
    );
    if let Some(c) = &cookie {
        if let Ok(s) = c.to_str() {
            use std::fmt::Write;
            let _ = write!(req, "Cookie: {s}\r\n");
        }
    }
    req.push_str("\r\n");

    if let Err(e) = tls_stream.write_all(req.as_bytes()).await {
        eprintln!("❌ WS proxy: error enviando handshake WS: {e}");
        return;
    }

    let upstream = tokio_tungstenite::WebSocketStream::from_raw_socket(
        tls_stream,
        Role::Client,
        None,
    )
    .await;

    let (mut up_tx, mut up_rx) = upstream.split();
    let (mut down_tx, mut down_rx) = socket.split();

    // browser -> upstream
    let to_up = async {
        while let Some(Ok(msg)) = down_rx.next().await {
            if up_tx.send(axum_to_tungstenite(msg)).await.is_err() {
                break;
            }
        }
        let _ = up_tx.close().await;
    };

    // upstream -> browser
    let to_down = async {
        while let Some(Ok(msg)) = up_rx.next().await {
            if let Some(m) = tungstenite_to_axum(msg) {
                if down_tx.send(m).await.is_err() {
                    break;
                }
            }
        }
        let _ = down_tx.close().await;
    };

    futures_util::join!(to_up, to_down);
}

fn axum_to_tungstenite(msg: axum::extract::ws::Message) -> tungstenite::Message {
    use axum::extract::ws::Message as M;
    use tokio_tungstenite::tungstenite::Utf8Bytes as TsUtf8;
    match msg {
        M::Text(t) => tungstenite::Message::Text(TsUtf8::from(t.as_str())),
        M::Binary(b) => tungstenite::Message::Binary(b),
        M::Ping(b) => tungstenite::Message::Ping(b),
        M::Pong(b) => tungstenite::Message::Pong(b),
        M::Close(Some(c)) => tungstenite::Message::Close(Some(TsCloseFrame {
            code: TsCloseCode::from(c.code),
            reason: TsUtf8::from(c.reason.as_str()),
        })),
        M::Close(None) => tungstenite::Message::Close(None),
    }
}

fn tungstenite_to_axum(msg: tungstenite::Message) -> Option<axum::extract::ws::Message> {
    use axum::extract::ws::{CloseFrame, Message as M, Utf8Bytes as AxUtf8};
    match msg {
        tungstenite::Message::Text(t) => Some(M::Text(AxUtf8::from(t.as_str()))),
        tungstenite::Message::Binary(b) => Some(M::Binary(b)),
        tungstenite::Message::Ping(b) => Some(M::Ping(b)),
        tungstenite::Message::Pong(b) => Some(M::Pong(b)),
        tungstenite::Message::Close(Some(c)) => Some(M::Close(Some(CloseFrame {
            code: c.code.into(),
            reason: AxUtf8::from(c.reason.as_str()),
        }))),
        tungstenite::Message::Close(None) => Some(M::Close(None)),
        tungstenite::Message::Frame(_) => None,
    }
}

// -------------------- Utilidades de cabeceras --------------------

fn strip_hop_by_hop(headers: &mut HeaderMap) {
    const HOP: &[&str] = &[
        "connection",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailer",
        "transfer-encoding",
        "upgrade",
        "content-length",
    ];
    // Cabeceras listadas en `Connection:` también son hop-by-hop.
    let mut extra: Vec<HeaderName> = Vec::new();
    if let Some(conn) = headers.get(header::CONNECTION) {
        if let Ok(s) = conn.to_str() {
            for tok in s.split(',') {
                let tok = tok.trim();
                if !tok.is_empty() {
                    if let Ok(n) = HeaderName::from_bytes(tok.as_bytes()) {
                        extra.push(n);
                    }
                }
            }
        }
    }
    for h in HOP {
        while headers.remove(*h).is_some() {}
    }
    for n in extra {
        while headers.remove(&n).is_some() {}
    }
}

fn rewrite_set_cookie(headers: &mut HeaderMap) {
    let cookies: Vec<HeaderValue> = headers
        .get_all(SET_COOKIE)
        .iter()
        .cloned()
        .collect();
    if cookies.is_empty() {
        return;
    }
    headers.remove(SET_COOKIE);

    for c in cookies {
        let raw = match c.to_str() {
            Ok(s) => s,
            Err(_) => {
                let _ = headers.append(SET_COOKIE, c);
                continue;
            }
        };
        let parts: Vec<&str> = raw.split(';').collect();
        // El primer elemento es el par name=value; se conserva tal cual.
        let mut rebuilt: Vec<String> = Vec::with_capacity(parts.len());
        if let Some(nameval) = parts.first() {
            rebuilt.push((*nameval).trim().to_string());
        }
        for attr in parts.iter().skip(1) {
            let attr = attr.trim();
            let lower = attr.to_ascii_lowercase();
            // Descarta Domain= (sería rechazado al venir de localhost).
            if lower.starts_with("domain=") {
                continue;
            }
            // Descarta Secure (la cookie no se almacenaría sobre http).
            if lower == "secure" {
                continue;
            }
            // SameSite=None sin Secure es inválido; mismo origen => Lax basta.
            if lower.starts_with("samesite=") {
                let val = lower["samesite=".len()..].trim();
                if val == "none" {
                    rebuilt.push("SameSite=Lax".to_string());
                    continue;
                }
            }
            rebuilt.push(attr.to_string());
        }

        let new_val = rebuilt.join("; ");
        if let Ok(hv) = HeaderValue::from_str(&new_val) {
            headers.append(SET_COOKIE, hv);
        } else {
            // Si la reescritura produce algo inválido, conservamos el original.
            let _ = headers.append(SET_COOKIE, c);
        }
    }
}
