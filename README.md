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
    sudo apt-get install -y network-manager-gnome chromium
    ```
3.  **Configurar el inicio automático (Modo Kiosco)**:
    Editaremos el archivo `.profile` del usuario para que el navegador se inicie automáticamente al entrar a la sesión gráfica.
    ```bash
    nano ~/.profile
    ```
    Añade el siguiente bloque al final del archivo:
    ```bash
    # Iniciar el modo kiosco de Chromium al iniciar la sesión gráfica
    if [ -n "$DISPLAY" ]; then
      # Espera 30s para dar tiempo a que los servicios de Docker se inicien tras un reinicio
      (sleep 30 && /usr/bin/chromium --kiosk --incognito --disable-pinch --no-first-run --ignore-certificate-errors https://localhost:5000) &
    fi
    ```
    Guarda el archivo (`Ctrl+X`, `Y`, `Enter`).

4.  **Reiniciar el sistema**:
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
    
    a. **En la estación**, genera un nuevo par de claves SSH:
    ```bash
    # Usa el algoritmo ed25519, que es moderno y seguro
    ssh-keygen -t ed25519 -C "github-actions-deploy"
    ```
    - Cuando pregunte por la ubicación, presiona **Enter** (para usar `~/.ssh/id_ed25519`).
    - Cuando pida una `passphrase`, **introduce una contraseña segura**.

    b. **Autoriza la clave** para que GitHub Actions pueda conectarse:
    ```bash
    cat ~/.ssh/id_ed25519.pub >> ~/.ssh/authorized_keys
    chmod 600 ~/.ssh/authorized_keys
    ```

    c. **Copia los contenidos** para usarlos como secretos en GitHub:
    ```bash
    # 1. Copia la CLAVE PRIVADA. Su contenido va en el secreto IOT_PRIVATE_KEY.
    cat ~/.ssh/id_ed25519
    
    # 2. La contraseña (passphrase) que elegiste va en el secreto IOT_PASSPHRASE.
    
    # 3. Tu nombre de usuario en la estación va en el secreto IOT_USERNAME.
    echo $USER 
    ```
    
    d. **En tu repositorio de GitHub**, ve a `Settings > Secrets and variables > Actions` y crea los siguientes secretos read package:
    - `IOT_PRIVATE_KEY`: Pega el contenido completo de tu clave privada (desde `-----BEGIN...` hasta `-----END...`).
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

## Guía de Instalación y Puesta en Marcha

Esta guía detalla los pasos para configurar una nueva estación de pesaje desde cero en un PC con una instalación limpia de Debian.

### Requisitos Previos

- Un PC con Debian 12 (o superior) instalado.
- Acceso físico a la máquina y conexión a internet.
- Hardware de la estación: Báscula, Impresora de etiquetas, Lector RFID.

### Paso 1: Configuración Inicial del Sistema y Usuario

Es crucial operar con un usuario no-root por seguridad. Crearemos un usuario `jumaar` y le daremos los permisos necesarios.

1.  **Crear el usuario `jumaar`**:
    ```bash
    sudo adduser jumaar
    ```

2.  **Añadir el usuario al grupo `sudo`**:
    Esto le permitirá ejecutar comandos administrativos.
    ```bash
    sudo usermod -aG sudo jumaar
    ```

3.  **Añadir el usuario al grupo `dialout`**:
    Este paso es **fundamental** para permitir que la aplicación acceda a los puertos serie y USB (báscula, impresora, RFID) sin necesidad de ser root.
    ```bash
    sudo usermod -aG dialout jumaar
    ```

4.  **Iniciar sesión como `jumaar`**:
    Cierra la sesión de root y continúa todos los pasos siguientes como el usuario `jumaar`.
    ```bash
    su - jumaar
    ```









### Paso 2: Configuración de Acceso Remoto (SSH y Cloudflare)

Para poder desplegar y administrar la estación de forma remota y segura, configuraremos el acceso a través de SSH protegido por un túnel de Cloudflare.

1.  **Generar Claves SSH en la Estación**:
    Como usuario `jumaar`, genera un par de claves SSH. Esto es necesario para que el sistema de despliegue automatizado (GitHub Actions) pueda conectarse.
    ```bash
    # Usa el algoritmo ed25519, que es moderno y seguro
    ssh-keygen -t ed25519 -C "jumaar@estacion-vorak"
    ```
    - Cuando te pregunte por la ubicación del archivo, presiona **Enter** para aceptar la ruta por defecto.
    - Cuando te pida una `IOT_PASSPHRASE` (contraseña), **introduce una contraseña segura**. La necesitarás para los secretos de GitHub `IOT_PASSPHRASE`.

2.  **Autorizar la Clave Pública**:
    Copia la clave pública recién creada al archivo de claves autorizadas. Esto permite que la máquina se conecte a sí misma vía SSH.
    ```bash
    cat ~/.ssh/id_ed25519.pub >> ~/.ssh/authorized_keys
    ```
    **Nota Importante**: El contenido de tu clave privada (`~/.ssh/id_ed25519`) deberá ser copiado y guardado como un secreto (`IOT_PRIVATE_KEY`) en tu repositorio de GitHub. Para ver el contenido y poder copiarlo, usa el comando:
    ```bash
    cat ~/.ssh/id_ed25519
    ```

3.  **Asegurar los Permisos de los Archivos SSH**:
    Los permisos incorrectos son una causa común de fallos de conexión SSH.
    ```bash
    chmod 700 ~/.ssh
    chmod 600 ~/.ssh/authorized_keys
    ```

4.  **Instalar `cloudflared` (Túnel de Cloudflare)**:
    Para acceso administrativo remoto seguro.
    ```bash
    curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
    sudo dpkg -i cloudflared.deb
    sudo cloudflared service install
    # Ahora configura tu túnel siguiendo la documentación de Cloudflare para que apunte al puerto 22 (SSH) de localhost.
    ```






### Paso 2: Instalación de Dependencias

1.  **Instalar Docker**:
    Docker es el corazón del despliegue. Sigue la guía oficial para instalar Docker Engine en Debian.
    ```bash
    # Añadir el repositorio de Docker
    sudo apt-get update
    sudo apt-get install -y ca-certificates curl
    sudo install -m 0755 -d /etc/apt/keyrings
    sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
    sudo chmod a+r /etc/apt/keyrings/docker.asc
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian \
      $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
      sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
    sudo apt-get update

    # Instalar Docker Engine, CLI, y Compose
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    ```

2.  **Añadir `jumaar` al grupo `docker`**:
    Para poder ejecutar comandos de Docker sin `sudo`.
    ```bash
    sudo usermod -aG docker jumaar
    ```
    **¡Importante!** Después de este comando, debes cerrar sesión y volver a iniciarla para que el cambio de grupo tenga efecto.







### Paso 3: Instalación del Entorno Gráfico Ligero (LXDE)

Para que el navegador pueda ejecutarse en modo kiosco, es necesario un entorno gráfico. Instalaremos LXDE, que es extremadamente ligero y consume muy pocos recursos.

1.  **Instalar LXDE Core y un gestor de inicio de sesión**:
    ```bash
    # Instala los componentes esenciales del escritorio LXDE y el gestor de sesión LightDM
    sudo apt-get install -y lxde-core lightdm
    ```
    Durante la instalación, es posible que te pregunte qué gestor de pantalla deseas usar por defecto. Elige **`lightdm`**.

2.  **Reiniciar el sistema**:
    Después de la instalación, reinicia la máquina para que se inicie en el nuevo entorno gráfico.
    ```bash
    sudo reboot
    ```
    Al reiniciar, deberías ver una pantalla de inicio de sesión gráfica. Inicia sesión como el usuario `jumaar`.

3.  **Instalar Gestor de Red (Para Wi-Fi y Ethernet)**:
    Para poder gestionar las conexiones de red (especialmente Wi-Fi) desde la interfaz gráfica, necesitas Network Manager.
    ```bash
    sudo apt-get install -y network-manager network-manager-gnome
    ```
    Después de la instalación, es recomendable reiniciar para que Network Manager tome el control total de las interfaces de red.
    ```




















### Paso 4: Configuración del Modo Kiosco

Configuraremos el inicio automático del navegador en modo kiosco editando el archivo de perfil del usuario. Este método es muy robusto ya que se ejecuta directamente al iniciar la sesión.

1.  **Instalar un navegador (ej. Chromium)**:
    ```bash
    sudo apt-get install -y chromium
    ```

2.  **Editar el archivo `.profile` del usuario**:
    Como usuario `jumaar`, abre el archivo `.profile` en tu directorio home.
    ```bash
    nano ~/.profile
    ```

3.  **Añadir el comando de inicio al final del archivo**:
    Ve hasta el final del archivo y pega el siguiente bloque de código.

    ```bash
    # Iniciar el modo kiosco de Chromium al iniciar la sesión gráfica
    if [ -n "$DISPLAY" ]; then
      (sleep 25 && /usr/bin/chromium --kiosk --incognito --disable-pinch --no-first-run --ignore-certificate-errors https://localhost:5000) &
    fi
    ```
    Guarda el archivo y cierra `nano` (Ctrl+X, luego Y, luego Enter).
    
    **Explicación del código**:
    - `if [ -n "$DISPLAY" ]`: Se asegura de que el comando solo se ejecute si hay una sesión gráfica activa.
    - `( ... ) &`: Ejecuta el comando en segundo plano para no bloquear el resto del inicio de sesión.
    - `sleep 25`: Espera 25 segundos para dar tiempo a que el servidor Docker se inicie.

4.  **Reiniciar la sesión**:
    Después de añadir el comando al archivo `.profile`, cierra la sesión del usuario `jumaar` y vuelve a iniciarla (o reinicia la máquina). Al iniciar la nueva sesión gráfica, el navegador se lanzará automáticamente después de la pausa.

    **Nota**: Los dispositivos de entrada estándar como el teclado y el ratón funcionarán normalmente dentro de la aplicación web. El modo kiosco solo restringe la interacción con el sistema operativo subyacente.

### Paso 5: Despliegue de la Aplicación VORAK










3.  **Autenticarse en el registro de Docker**:
    ```bash
    # Usa tu usuario de GitHub y un Personal Access Token (PAT) con permisos `read:packages`.
    docker login ghcr.io
    ```

4.  **Crear y configurar el archivo de entorno**:
    ```bash
    cp .env.template .env
    nano .env
    ```
    Rellena todas las variables,`GHCR_USER`/`GHCR_TOKEN`.

5.  **Desplegar la aplicación**:
    ```bash
    # El flag -p define un nombre de proyecto para evitar conflictos.
    `docker compose -p estacion up -d`
    ```
















1.  **Clonar el repositorio**:
    Desde el directorio home de `jumaar`.
    ```bash
    git clone https://github.com/jumaar/estacion-vorak.git
    cd estacion-vorak
    ```

2.  **Configurar el archivo `.env`**:
    El script de despliegue depende de un archivo `.env`. Crea este archivo en la raíz del proyecto (`estacion-vorak/.env`) con las variables necesarias.
    ```env
    # .env
    PORT=5000
    HOST=0.0.0.0
    NESTJS_API_BASE_URL=https://api.tudominio.com
    
    # Credenciales para descargar la imagen de Docker desde GHCR
    GHCR_USER=tu_usuario_github
    GHCR_TOKEN=tu_token_de_acceso_personal
    ```

3.  **Ejecutar el script de despliegue**:
    El script `deploy.sh` se encargará de todo: iniciar sesión en el registro de Docker, descargar la última imagen y levantar el servicio.
    ```bash
    ./deploy.sh
    ```

¡Listo! En este punto, la aplicación Docker debería estar corriendo, y el navegador en modo kiosco debería mostrar la interfaz de login en `https://localhost:5000`.