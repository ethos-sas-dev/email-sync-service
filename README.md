# Servicio de Sincronización de Correos

Este microservicio está diseñado para sincronizar correos electrónicos desde un servidor IMAP con una base de datos Strapi de manera independiente y eficiente.

## Características

- ✅ Sincronización automática programada mediante expresiones cron
- ✅ Sincronización manual a través de API REST o script de línea de comandos
- ✅ Obtención completa de correos (encabezados y cuerpo)
- ✅ Procesamiento por lotes para mejor rendimiento
- ✅ Endpoints para gestión de correos y estados
- ✅ Estadísticas detalladas del proceso de sincronización
- ✅ Diseñado para funcionar independientemente de la aplicación principal

## Instalación

1. Clona este repositorio o copia la carpeta `email-sync-service` a tu servidor
2. Instala las dependencias:

```bash
cd email-sync-service
npm install
```

3. Copia el archivo `.env.example` a `.env` y configura tus variables de entorno:

```bash
cp .env.example .env
```

4. Edita el archivo `.env` con tus datos de configuración:
   - Credenciales del servidor IMAP
   - URL y token de la API de Strapi
   - Puerto del servidor y configuración de cron

## Uso

### Iniciar el servidor

Para iniciar el servidor en modo desarrollo:

```bash
npm run dev
```

Para compilar y ejecutar en producción:

```bash
npm run build
npm start
```

### Ejecutar una sincronización manual

Para ejecutar una sincronización única desde la línea de comandos:

```bash
npm run sync
```

### Endpoints de la API

El servicio expone los siguientes endpoints:

- `GET /` - Verificar que el servicio está funcionando
- `GET /api/sync/status` - Ver estadísticas de la última sincronización
- `POST /api/sync/start` - Iniciar una sincronización manual
- `GET /api/emails` - Obtener todos los correos desde Strapi
- `GET /api/emails/:emailId/content` - Obtener contenido completo de un correo
- `POST /api/emails/:emailId/status` - Actualizar estado de un correo

### Configuración de Cron

Por defecto, el servicio está configurado para ejecutar una sincronización cada 15 minutos.
Puedes modificar esto cambiando la variable `SYNC_CRON` en el archivo `.env`, usando formato cron:

```
# Cada hora
SYNC_CRON=0 * * * *

# Cada 5 minutos
SYNC_CRON=*/5 * * * *

# Cada día a medianoche
SYNC_CRON=0 0 * * *
```

## Integración con Next.js

Para usar este servicio con tu aplicación Next.js, puedes:

1. **Desplegarlo como un servicio independiente** y modificar tu aplicación Next.js para obtener los correos desde Strapi
2. **Llamar a las APIs del servicio** desde tu aplicación Next.js cuando necesites sincronizar o obtener datos de correos

## Despliegue en producción

Para desplegar en producción, recomendamos:

1. Usar PM2 para gestionar el proceso:

```bash
npm install -g pm2
pm2 start dist/index.js --name email-sync-service
```

2. Configurar un proxy inverso (Nginx, Apache) para servir la API
3. Asegurarte de que las variables de entorno están correctamente configuradas

## Solución de problemas

- Verifica la conexión al servidor IMAP
- Asegúrate de que el token de Strapi tiene permisos adecuados
- Revisa los logs para identificar errores específicos
- Si hay timeout en producción, reduce el tamaño de lote (`batchSize`)

## Licencia

Este proyecto está licenciado bajo la licencia MIT. 