/* ============================================================
   server/almacenamiento-local.js
   MODO PRUEBA de fotos, mientras Cloudflare R2 no esté configurado.

   El diseño definitivo (DECISIONES.md D-003) es que el celular sube
   la foto DIRECTO a R2 y el servidor nunca toca el archivo. Pero
   hasta que exista el bucket, esto permite probar todo el flujo
   (cámara → compresión → orden → vista previa) guardando la foto en
   el disco del servidor.

   Diferencias con el modo real, a tener presentes:
     · Acá el archivo SÍ pasa por el servidor.
     · Las fotos quedan en server/uploads_local/ (gitignored) y se
       sirven por una ruta con sesión (GET /api/ordenes/:id/foto/:fotoId),
       no por una URL pública como en R2.
     · Las fotos guardadas en este modo NO se migran solas a R2
       después: quedan como URLs locales.

   Cuando r2Habilitado() devuelva true, el frontend usa R2 y este
   módulo deja de entrar en juego (ver server/r2.js).
   ============================================================ */

const fs   = require('fs');
const path = require('path');

const CARPETA = path.join(__dirname, 'uploads_local');

/* Siempre JPEG: el navegador comprime a image/jpeg antes de subir
   (canvas.toBlob en js/pedidos.js), así el nombre del archivo se
   puede reconstruir desde los ids sin guardar la extensión aparte. */
const EXTENSION = 'jpg';

function nombreArchivo(ordenId, fotoId) {
  return `orden-${parseInt(ordenId, 10)}-foto-${parseInt(fotoId, 10)}.${EXTENSION}`;
}

function rutaArchivo(ordenId, fotoId) {
  return path.join(CARPETA, nombreArchivo(ordenId, fotoId));
}

async function guardarFoto(ordenId, fotoId, buffer) {
  await fs.promises.mkdir(CARPETA, { recursive: true });
  await fs.promises.writeFile(rutaArchivo(ordenId, fotoId), buffer);
  return nombreArchivo(ordenId, fotoId);
}

function existeFoto(ordenId, fotoId) {
  return fs.existsSync(rutaArchivo(ordenId, fotoId));
}

module.exports = { guardarFoto, rutaArchivo, existeFoto, CARPETA };
