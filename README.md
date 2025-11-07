# VORAK - Módulo de Estación de Pesaje Inteligente

Este repositorio contiene el software para el módulo de borde (edge) de la estación de pesaje inteligente de VORAK. La aplicación está diseñada para ejecutarse en un dispositivo dedicado (como un mini PC con Debian) conectado directamente al hardware de pesaje, impresión y lectura RFID.

## Características Principales

- **Servidor Web Local**: Proporciona una interfaz de usuario web (dashboard) accesible localmente para la operación.
- **Comunicación en Tiempo Real**: Utiliza WebSockets para mostrar el peso de la báscula y el estado de los dispositivos en tiempo real.
- **Integración con Hardware**:
  - Se conecta a básculas industriales a través del puerto serie.
  - Gestiona impresoras de etiquetas térmicas a través de USB.
  - Monitorea la conexión de lectores RFID/TAG (que actúan como teclado USB).
- **Cola de Impresión**: Gestiona los trabajos de impresión de forma asíncrona para no bloquear la operación.
- **Interfaz de Kiosco**: Diseñada para ser usada en un navegador en modo kiosco para una experiencia de usuario dedicada.
- **Contenerización**: Toda la aplicación se ejecuta dentro de un contenedor Docker para un despliegue fácil y consistente.

---

## Guía de Puesta en Marcha de una Nueva Estación

Esta guía detalla los pasos para configurar una nueva estación de pesaje desde cero en un PC con una instalación limpia de Debian. El proceso se divide en dos fases:
1.  **Configuración Inicial del Dispositivo (One-Time Setup)**: Pasos que se realizan una única vez en la máquina física.
2.  **Ciclo de Despliegue (CI/CD)**: Cómo se actualiza el software de forma remota y automática.

---

## Fase 1: Configuración Inicial del Dispositivo (One-Time Setup)

### 1.1. Requisitos Previos

- Un PC con Debian 12 (o superior) instalado.
- Acceso físico a la máquina y conexión a internet.
- Hardware de la estación: Báscula, Impresora de etiquetas, Lector RFID.

### 1.2. Creación de Usuario y Permisos

Es crucial operar con un usuario no-root por seguridad. Crearemos un usuario `jumaar` y le daremos los permisos necesarios.

1.  **Crear el usuario `jumaar`**:
    ```bash
    sudo adduser jumaar
    ```

2.  **Añadir el usuario a los grupos necesarios**:
    ```bash
    # Permite ejecutar comandos administrativos
    sudo usermod -aG sudo jumaar
    
    # Permite a la aplicación acceder a puertos serie/USB (báscula, impresora)
    sudo usermod -aG dialout jumaar
    
    # Permite ejecutar comandos de Docker sin `sudo`
    sudo usermod -aG docker jumaar
    ```
    **¡Importante!** Después de estos comandos, debes **cerrar sesión y volver a iniciarla** para que los cambios de grupo tengan efecto. A partir de ahora, todos los comandos se ejecutan como el usuario `jumaar`.

### 1.3. Instalación de Dependencias Clave

1.  **Instalar Git y Docker**:
    ```bash
    # Añadir el repositorio de Docker
    sudo apt-get update
    sudo apt-get install -y ca-certificates curl
    sudo install -m 0755 -d /etc/apt/keyrings
    sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
    sudo chmod a+r /etc/apt/keyrings/docker.asc
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
    sudo apt-get update
    
    # Instalar Git, Docker Engine, CLI y Compose
    sudo apt-get install -y git docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    ```

2.  **Instalar `cloudflared` (Túnel de Cloudflare)**:
    Para el acceso remoto seguro desde GitHub Actions.
    ```bash
    curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
    sudo dpkg -i cloudflared.deb
    sudo cloudflared service install
    # Ahora configura tu túnel en el dashboard de Cloudflare para que apunte al puerto 22 (SSH) de localhost.
    ```

### 1.4. Instalación del Entorno Gráfico y Modo Kiosco

Para que el navegador pueda ejecutarse en modo kiosco, es necesario un entorno gráfico. Instalaremos LXDE, que es extremadamente ligero.

1.  **Instalar LXDE Core y un gestor de inicio de sesión**:
    ```bash
    sudo apt-get install -y lxde-core lightdm
    ```
    Durante la instalación, es posible que te pregunte qué gestor de pantalla deseas usar por defecto. Elige **`lightdm`**.

2.  **Instalar Gestor de Red y Navegador**:
    Para poder gestionar las conexiones de red (especialmente Wi-Fi) desde la interfaz gráfica y tener un navegador para el modo kiosco.

    ```bash
    # Instalar el gestor de red
    sudo apt-get install -y network-manager-gnome

    # Descargar e instalar Google Chrome
    curl -L -o google-chrome-stable_current_amd64.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
    sudo apt install -y ./google-chrome-stable_current_amd64.deb

    # Limpiar el archivo .deb descargado
    rm google-chrome-stable_current_amd64.deb
    ```

3.  **Asegurar el Módulo del Kernel para Impresora USB**:
    En algunas instalaciones mínimas de Debian, el módulo del kernel para impresoras USB (`usblp`) no se carga por defecto. Esto es necesario para que el sistema cree el archivo de dispositivo `/dev/usb/lpX`.

    ```bash
    # Cargar el módulo en la sesión actual para probar de inmediato
    sudo modprobe usblp
    # Asegurar que el módulo se cargue en cada arranque del sistema
    echo "usblp" | sudo tee -a /etc/modules
    ```

4.  **Deshabilitar el Servicio de Impresión CUPS (¡Importante!)**:
    El sistema operativo intentará gestionar la impresora USB automáticamente a través de un servicio llamado CUPS. Esto entra en conflicto con nuestro script, que necesita acceso directo al dispositivo para enviar comandos de bajo nivel. Debemos deshabilitar CUPS para evitar esta interferencia.

    ```bash
    # Detener el servicio CUPS si se está ejecutando actualmente
    sudo systemctl stop cups

    # Deshabilitar CUPS para que no se inicie automáticamente en el arranque
    sudo systemctl disable cups
    ```
    Este paso es crucial para que el script `estacion.py` pueda comunicarse directamente con la impresora.

5.  **Configurar el Modo Kiosco (Método Manual)**:
    El flag `--ignore-certificate-errors` de Chromium ya no es fiable. El método más seguro es importar manualmente nuestro certificado SSL local y crear una "app" para la página, que se ejecutará en modo kiosco.

    a. **Inicia sesión en el escritorio de la estación** con el usuario `jumaar`.

    b. **Importa el certificado en Chromium**:
    - Abre una terminal y navega al directorio del proyecto: `cd ~/estacion-vorak`.
    - Abre Chrome.
    - Ve a `chrome://certificate-manager/localcerts/usercerts`.
    - En la pestaña `Autoridades`, haz clic en `Importar`.
    - Se abrirá un explorador de archivos. Navega a la carpeta del proyecto (`/home/jumaar/estacion-vorak`).
    - Selecciona el archivo `localhost.pem` y haz clic en `Abrir`.
    - Marca la casilla **"Confiar en este certificado para identificar sitios web"** y haz clic en `Aceptar`.

    c. **Crea la aplicación de Kiosco**:
    - En Chromium, navega a `https://localhost:5000`. La página debería cargar sin advertencias de seguridad.
    - Haz clic en el menú de tres puntos de Chromium (arriba a la derecha).
    - Selecciona `Guardar y compartir` > `Crear acceso directo...`.
    - Dale un nombre (ej. "VORAK Estación"), marca la casilla **"Abrir como ventana"** y haz clic en `Crear`.

    d. **Configura el inicio automático**:
    - Una vez creada la aplicación, ve a la página de aplicaciones de Chromium escribiendo `chrome://apps` en la barra de direcciones.
    - Haz clic derecho sobre la nueva aplicación ("VORAK Estación").
    - En el menú que aparece, selecciona **"Iniciar aplicación al iniciar sesión"**.

6.  **Reiniciar el sistema**:
    ```bash
    sudo reboot
    ```
    Al reiniciar, inicia sesión como `jumaar`. El escritorio aparecerá y, tras 30 segundos, el navegador se abrirá en modo kiosco.

### 1.5. Preparación para el Despliegue Automatizado

1.  **Clonar el repositorio en la estación**:
    ```bash
    git clone https://github.com/jumaar/estacion-vorak.git
    cd estacion-vorak
    ```

2.  **Crear el archivo `.env` en la estación**:
    Este archivo contiene los secretos locales que la aplicación necesita para funcionar. El script de despliegue lo utilizará.
    ```env
    # En la estación, crea el archivo: nano ~/estacion-vorak/.env
    # Servidor
    HOST=127.0.0.1
    PORT=5000

    # URL base de tu backend NestJS (donde se maneja la autenticación principal)
    NESTJS_API_BASE_URL=https://api.

    # Clave PÚBLICA de Turnstile (para el frontend). Obtenla de tu panel de Cloudflare. Esta es la única clave de Turnstile que necesita el servidor Flask.
    TURNSTILE_SITE_KEY=


    # Configuración de impresión
    ANCHO_DOTS_ETIQUETA=320
    ALTO_DOTS_ETIQUETA=240

    GHCR_USER=jumaar
    GHCR_TOKEN=ghp_xxxxxxxx
    ```

3.  **Generar Claves SSH y Configurar Secretos de GitHub**:
    Este es el paso más importante para habilitar el despliegue automático.
    Usaremos un par de claves SSH: la **clave pública** (la "cerradura") se queda en la estación, y la **clave privada** (la "llave") se guarda de forma segura en GitHub.

    a. **En la estación**, genera el par de claves (llave y cerradura):
    ```bash
    # Genera una clave tipo RSA de 4096 bits para máxima compatibilidad
    ssh-keygen -t rsa -b 4096 -C "github-actions-deploy-rsa"
    ```
    - Cuando te pregunte por la ubicación del archivo, presiona **Enter** para aceptar la ruta por defecto (`~/.ssh/id_rsa`).
    - Cuando pida una `passphrase`, **introduce una contraseña segura**. La necesitarás para un secreto de GitHub.

    b. **En la estación**, instala la "cerradura" (la clave pública) para autorizar conexiones:
    ```bash
    cat ~/.ssh/id_rsa.pub >> ~/.ssh/authorized_keys
    chmod 600 ~/.ssh/authorized_keys
    ```

    c. **Prepara los secretos** para guardarlos en GitHub:
    ```bash
    # 1. MUESTRA LA LLAVE SECRETA. El contenido de este comando es lo que debes copiar.
    # Este texto es extremadamente sensible.
    cat ~/.ssh/id_rsa
    
    # 2. La CONTRASEÑA (passphrase) que elegiste en el paso 'a' va en el secreto IOT_PASSPHRASE.
    
    # 3. Tu NOMBRE DE USUARIO en la estación va en el secreto IOT_USERNAME.
    echo $USER 
    ```
    
    d. **En tu repositorio de GitHub**, ve a `Settings > Secrets and variables > Actions` y crea/actualiza los siguientes secretos:
    - `IOT_PRIVATE_KEY`: Pega el contenido completo de tu clave privada (el resultado de `cat ~/.ssh/id_rsa`). Debe empezar con `-----BEGIN...` y terminar con `-----END...`.
    - `IOT_PASSPHRASE`: Escribe la contraseña que creaste para la clave SSH.
    - `IOT_USERNAME`: Escribe tu nombre de usuario en la estación (ej. `jumaar`).

¡Listo! En este punto, la estación está preparada para recibir despliegues automáticos. No necesitas ejecutar `deploy.sh` manualmente.

---

## Fase 2: Ciclo de Despliegue Automatizado (CI/CD)

Una vez completada la configuración inicial, ya no necesitas interactuar directamente con la estación para actualizarla. Todo se gestiona a través de Git y GitHub Actions.

### Despliegue de Desarrollo (`main`)

Cada vez que haces un `push` a la rama `main`, el workflow `.github/workflows/build-main.yml` se activa automáticamente.

- **Acción**: `git push origin main`
- **Resultado**: Se construye una nueva imagen Docker, se etiqueta con el hash del commit (ej. `sha-7f4d5a6`) y con la etiqueta `main`, y se publica en el registro de contenedores de GitHub (GHCR). **No se despliega en la estación**.

### Despliegue a Producción (Creando un Tag)

Para desplegar una nueva versión en todas las estaciones de la flota, simplemente crea y empuja un tag de Git que siga el formato de versionado semántico.

- **Acción**:
  ```bash
  # 1. Crea un tag (ej. v1.0.1)
  git tag v1.0.1
  
  # 2. Empuja el tag al repositorio remoto
  git push origin v1.0.1
