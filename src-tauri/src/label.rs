use ab_glyph::{FontRef, PxScale};
use image::{GrayImage, Luma};
use imageproc::drawing::draw_text_mut;
use std::path::Path;

const ANCHO_DOTS: u32 = 320;
const ALTO_DOTS: u32 = 240;
const ANCHO_BYTES: u32 = ANCHO_DOTS / 8;

const TAMANO_NORMAL: f32 = 36.0;
const TAMANO_GRANDE: f32 = 54.0;
const TAMANO_PEQUENO: f32 = 20.0;
const TAMANO_MEDIO: f32 = 25.0;
const TAMANO_GRANDE_VENC: f32 = 25.0;

const X_POS: i32 = 5;
const X_OFFSET: i32 = -30;

struct FontSizes {
    normal: PxScale,
    grande: PxScale,
    pequeno: PxScale,
    medio: PxScale,
    grande_venc: PxScale,
}

pub fn render_label(
    fecha_hora: &str,
    fecha_vencimiento: &str,
    peso_g: i32,
    precio_total: f64,
    font_data: &[u8],
) -> Vec<u8> {
    let font = FontRef::try_from_slice(font_data).expect("Failed to load font");

    let sizes = FontSizes {
        normal: PxScale::from(TAMANO_NORMAL),
        grande: PxScale::from(TAMANO_GRANDE),
        pequeno: PxScale::from(TAMANO_PEQUENO),
        medio: PxScale::from(TAMANO_MEDIO),
        grande_venc: PxScale::from(TAMANO_GRANDE_VENC),
    };

    let mut img = GrayImage::from_pixel(ANCHO_DOTS, ALTO_DOTS, Luma([255u8]));

    let linea_alto_normal = TAMANO_NORMAL as i32 + 8;
    let linea_alto_pequeno = TAMANO_PEQUENO as i32 + 6;
    let linea_alto_medio = TAMANO_MEDIO as i32 + 6;
    let linea_alto_grande_venc = TAMANO_GRANDE_VENC as i32 + 6;

    let mut y_pos = 15i32;

    draw_text_mut(
        &mut img,
        Luma([0u8]),
        X_POS,
        y_pos,
        sizes.pequeno,
        &font,
        "Fecha de empaque:",
    );
    y_pos += linea_alto_pequeno;

    draw_text_mut(
        &mut img,
        Luma([0u8]),
        X_POS,
        y_pos,
        sizes.medio,
        &font,
        fecha_hora,
    );
    y_pos += linea_alto_medio;

    draw_text_mut(
        &mut img,
        Luma([0u8]),
        X_POS,
        y_pos,
        sizes.pequeno,
        &font,
        "Vence:",
    );
    y_pos += linea_alto_pequeno;

    draw_text_mut(
        &mut img,
        Luma([0u8]),
        X_POS,
        y_pos,
        sizes.grande_venc,
        &font,
        fecha_vencimiento,
    );
    y_pos += linea_alto_grande_venc;

    draw_text_mut(
        &mut img,
        Luma([0u8]),
        X_POS,
        y_pos,
        sizes.normal,
        &font,
        &format!("Peso: {}g", peso_g),
    );
    y_pos += linea_alto_normal;

    let precio_str = format!("${:.0}", precio_total);
    draw_text_mut(
        &mut img,
        Luma([0u8]),
        X_POS,
        y_pos,
        sizes.grande,
        &font,
        &precio_str,
    );

    let bitmap = image_to_1bit(&img);

    let mut tspl = Vec::new();
    tspl.extend_from_slice(b"CLS\n");
    tspl.extend_from_slice(b"SIZE 40 mm, 30 mm\n");
    tspl.extend_from_slice(b"GAP 0, 0\n");
    tspl.extend_from_slice(b"DENSITY 15\n");

    let header = format!("BITMAP {}, 0, {}, {}, 0, ", X_OFFSET, ANCHO_BYTES, ALTO_DOTS);
    tspl.extend_from_slice(header.as_bytes());
    tspl.extend_from_slice(&bitmap);
    tspl.extend_from_slice(b"\n");
    tspl.extend_from_slice(b"PRINT 1\n");

    tspl
}

fn image_to_1bit(img: &GrayImage) -> Vec<u8> {
    let mut bitmap = Vec::with_capacity((ANCHO_BYTES * ALTO_DOTS) as usize);

    for y in 0..ALTO_DOTS {
        let mut row_bytes = vec![0u8; ANCHO_BYTES as usize];
        for x in 0..ANCHO_DOTS {
            let pixel = img.get_pixel(x, y);
            let value = pixel[0];
            let bit = (value < 128) as u8;
            if bit == 1 {
                let byte_idx = (x / 8) as usize;
                let bit_idx = 7 - (x % 8) as usize;
                row_bytes[byte_idx] |= 1 << bit_idx;
            }
        }
        bitmap.extend_from_slice(&row_bytes);
    }

    bitmap
}

pub fn load_font(resource_dir: &Path) -> Vec<u8> {
    let font_path = resource_dir.join("fonts").join("DejaVuSans-Bold.ttf");
    if font_path.exists() {
        std::fs::read(&font_path).unwrap_or_else(|_| {
            let sys_path = Path::new("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf");
            std::fs::read(sys_path).expect("Failed to load font")
        })
    } else {
        let sys_path = Path::new("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf");
        std::fs::read(sys_path).expect("Failed to load font")
    }
}
