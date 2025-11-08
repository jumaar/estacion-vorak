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

### 1.1. Instalación del Sistema Operativo

1.  **Instalar Linux Mint**: Comienza con una instalación limpia de [Linux Mint](https://linuxmint.com/) (versión 21 o superior recomendada) en el PC de la estación Crear el usuario `estacion`.
2.  **Requisitos**: Asegúrate de tener acceso físico a la máquina para la instalación inicial y una conexión a internet activa.
3.  **Hardware**: Conecta el hardware de la estación (Báscula, Impresora de etiquetas, Lector RFID) al PC.
4.  actualizar linux mint desde el instalador de actualizaciones

5.   Necesitarás esta IP para conectarte desde tu PC de desarrollo.
    ```bash
    hostname -I
    # Anota la dirección IP que aparezca (ej. 192.168.0.102)
    ```
6.  **Instalar el servidor SSH**:
    Abre una terminal en la máquina de la estación e instala el servidor OpenSSH.

    ```bash
    sudo apt install openssh-server
    ```
7.  **A el usuario `estacion` darle permisos `sudo`**:
    Aún en la terminal física de la estación, dar permisos.

    ```bash
    sudo usermod -aG sudo estacion
    sudo reboot
    ```
    **¡Listo!**  El resto de la configuración se hará de forma remota.

8.  **Conectarse desde el PC de Desarrollo**:
    Desde tu propia máquina, conéctate a la estación usando la IP que anotaste.
    ```bash
    # Reemplaza 192.168.0.102 con la IP de tu estación
    ssh estacion@192.168.0.102
    ```
    A partir de ahora, todos los siguientes comandos se ejecutan en la terminal remota conectado a la estación.

### 1.2. Configuración de Acceso Remoto Global (Cloudflare)

Una vez dentro por SSH local, instalaremos Cloudflare Tunnel para poder acceder a la estación desde cualquier lugar (necesario para los despliegues automáticos desde GitHub Actions).

1.  **Instalar `cloudflared`**:
    ```bash
    curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
    sudo dpkg -i cloudflared.deb
    sudo cloudflared service install

    # Ahora, ve a tu dashboard de Cloudflare Zero Trust y configura un túnel que apunte a 'ssh://localhost:22' en este dispositivo.
    ```


2.  **Instalar Git y Docker**:
    ```bash
    
    # 2. Añadir el repositorio oficial de Docker para Ubuntu (compatible con Linux Mint)
    sudo apt-get install -y ca-certificates curl
    sudo install -m 0755 -d /etc/apt/keyrings
    sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    sudo chmod a+r /etc/apt/keyrings/docker.asc
    
    # 3. Añadir el repositorio a las fuentes de APT.
    # Usamos $UBUNTU_CODENAME en lugar de $VERSION_CODENAME para obtener el nombre base de Ubuntu (ej. "jammy")
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$UBUNTU_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
    sudo apt-get update
    
    # Instalar Git, Docker Engine, CLI y Compose
    sudo apt-get install -y git docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

### 1.3. Permisos de Hardware y Docker

Ahora que tenemos acceso remoto, daremos al usuario `estacion` los permisos necesarios para interactuar con el hardware (impresora, báscula) y para ejecutar comandos de Docker sin `sudo`.

1.  **Añadir el usuario `estacion` a los grupos requeridos**:
    ```bash
    # Permite a la aplicación acceder a puertos serie/USB (báscula, impresora)
    sudo usermod -aG dialout estacion
    
    # Permite ejecutar comandos de Docker sin `sudo` (¡CRUCIAL PARA EL DESPLIEGUE!)
    sudo usermod -aG docker estacion
    ```
2.  **Eliminar el Servicio de Impresión CUPS (¡Importante!)**:
    El sistema operativo puede instalar un servicio de impresión llamado CUPS, que gestiona impresoras de forma automática. Esto entra en conflicto con nuestro script, que necesita acceso directo y exclusivo al dispositivo USB. Para evitar esta interferencia, lo eliminaremos por completo.

    ```bash
    # Eliminar completamente CUPS y sus archivos de configuración
    sudo apt-get purge -y cups
    # Eliminar dependencias que ya no son necesarias
    sudo apt-get autoremove -y
    ```
    Este paso es crucial para que el script `estacion.py` pueda comunicarse directamente con la impresora sin que otro servicio "secuestre" el puerto.

### 1.4. Configuración de Seguridad Básica (Firewall)

Antes de continuar, es fundamental asegurar la estación configurando el firewall. Esto bloqueará todos los puertos (como SSH) de la red local, permitiendo el acceso únicamente a través del túnel seguro de Cloudflare que configuraremos más adelante.

1.  **Establecer reglas por defecto con `ufw`**:
    `ufw` (Uncomplicated Firewall) viene con Linux Mint y es fácil de usar.
    ```bash
    # Denegar todas las conexiones entrantes por defecto
    sudo ufw default deny incoming
    # Permitir todas las conexiones salientes (necesario para el túnel y las actualizaciones)
    sudo ufw default allow outgoing
    ```

2.  **Habilitar el firewall**:
    ```bash
    sudo ufw enable
    ```
    Cuando te pregunte si quieres continuar, escribe `y` y presiona Enter. Esto no interrumpirá tu sesión SSH local actual, pero impedirá nuevas conexiones desde la red local.

3.  **Reiniciar la estación para aplicar los cambios de grupo**:
    Este paso es **obligatorio**. Los cambios de membresía de grupo solo tienen efecto después de un reinicio o un nuevo inicio de sesión.
        
    ```bash
    sudo reboot
    ```

    
4.  **Verificar la instalación de Docker**:
    Después del reinicio, vuelve a conectarte por SSH y ejecuta este comando **sin `sudo`**. Debería funcionar y mostrar una salida vacía o la versión de Docker, pero no un error de permisos.
    ```bash
    docker ps
    # Si este comando funciona sin 'sudo', ¡la configuración es correcta!
    ```





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

    GHCR_USER=estacion
    GHCR_TOKEN=ghp_xxxxxxxx
    ```

3.  **Permitir Reinicio Remoto sin Contraseña (para CI/CD)**:
    El script de despliegue necesita reiniciar la estación. Para que `sudo reboot` funcione sin pedir contraseña en un script, crearemos una regla específica.

    a. **Crear el archivo de configuración para `sudo`**:
    ```bash
    echo 'estacion ALL=(ALL) NOPASSWD: /sbin/reboot' | sudo tee /etc/sudoers.d/99-vorak-reboot
    ```
    b. **Establecer los permisos correctos (¡Crítico!)**:
    `sudo` ignorará el archivo si los permisos no son seguros.
    ```bash
    sudo chmod 0440 /etc/sudoers.d/99-vorak-reboot
    ```

4.  **Generar Claves SSH y Configurar Secretos de GitHub**:
    Este es el paso más importante para habilitar el despliegue automático.
    Usaremos un par de claves SSH: la **clave pública** (la "cerradura") se queda en la estación, y la **clave privada** (la "llave") se guarda de forma segura en GitHub.

    a. **En la estación**, genera el par de claves (llave y cerradura):
    ```bash
    # Genera una clave tipo RSA de 4096 bits para máxima compatibilidad
    ssh-keygen -t rsa -b 4096 -C "github-actions-deploy-rsa"
    ```
    - Cuando te pregunte por la ubicación del archivo, presiona **Enter** para aceptar la ruta por defecto (`~/.ssh/id_rsa`).
    - Cuando pida una PASSPHRASE es la `IOT_PASSPHRASE`, **introduce una contraseña segura**. La necesitarás para un secreto de GitHub.

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
    
    # 2. La CONTRASEÑA (passphrase) que elegiste en el paso 'a' va en el secreto `IOT_PASSPHRASE`.
    
    # 3. Tu NOMBRE DE USUARIO en la estación va en el secreto IOT_USERNAME.
    echo $USER 
    ```
    
    d. **En tu repositorio de GitHub**, ve a `Settings > Secrets and variables > Actions` y crea/actualiza los siguientes secretos:
    - `IOT_PRIVATE_KEY`: Pega el contenido completo de tu clave privada (el resultado de `cat ~/.ssh/id_rsa`). Debe empezar con `-----BEGIN...` y terminar con `-----END...`.
    - `IOT_PASSPHRASE`: Escribe la contraseña que creaste para la clave SSH.
    - `IOT_USERNAME`: Escribe tu nombre de usuario en la estación (ej. `estacion`).

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


###  **Crea la aplicación de vorak estaciion en modo app de chrome**:

    a. **Inicia sesión en el escritorio de la estación** con el usuario `estacion`.
    - En Chrome, navega a `https://localhost:5000`. La página debería cargar sin advertencias de seguridad sino realiza paso b.
    - Haz clic en el menú de tres puntos de Chromium (arriba a la derecha).
    - Selecciona `Guardar y compartir` > `Crear acceso directo...`.
    - Dale un nombre (ej. "VORAK Estación"), marca la casilla **"Abrir como ventana"** y haz clic en `Crear`.

    b. **Importa el certificado en Chromium**:
    - Abre una terminal y navega al directorio del proyecto: `cd ~/estacion-vorak`.
    - Abre Chrome.
    - Ve a `chrome://certificate-manager/localcerts/usercerts`.
    - En la pestaña `Autoridades`, haz clic en `Importar`.
    - Se abrirá un explorador de archivos. Navega a la carpeta del proyecto (`/home/estacion/estacion-vorak`).
    - Selecciona el archivo `localhost.pem` y haz clic en `Abrir`.
    - Marca la casilla **"Confiar en este certificado para identificar sitios web"** y haz clic en `Aceptar`.


    c. **Configura el inicio automático**:
    - Una vez creada la aplicación, ve a la página de aplicaciones de Chromium escribiendo `chrome://apps` en la barra de direcciones.
    - Haz clic derecho sobre la nueva aplicación ("VORAK Estación").
    - En el menú que aparece, selecciona **"Iniciar aplicación al iniciar sesión"**.

**Reiniciar el sistema**:
    ```bash
    sudo reboot
    ```
    Al reiniciar, inicia sesión como `estacion`. El escritorio aparecerá y, tras 30 segundos, el navegador se abrirá en modo kiosco.
