/* ============================================================
   server/r2.js — Cloudflare R2 (evidencia fotográfica)
   Ver DECISIONES.md D-003. El servidor NUNCA toca el archivo:
   solo emite una URL firmada (presigned PUT) para que el celular
   suba la foto directo a R2, y guarda la URL final en la BD.

   Variables de entorno necesarias (server/.env, NO commitear):
     R2_ACCOUNT_ID        — Account ID de Cloudflare
     R2_ACCESS_KEY_ID     — Access Key ID del token R2
     R2_SECRET_ACCESS_KEY — Secret Access Key del token R2
     R2_BUCKET            — nombre del bucket (ej: velox-evidencias)
     R2_PUBLIC_URL         — base pública para LEER las fotos
                             (dominio propio conectado al bucket,
                             o la URL r2.dev si la habilitaste)

   Mientras esas variables no estén configuradas, r2Habilitado()
   devuelve false y las rutas que dependen de esto responden con
   un error claro en vez de romper el servidor — este módulo es
   opcional hasta que se complete el setup (ver DECISIONES.md D-003).
   ============================================================ */

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('crypto');

function r2Habilitado() {
  return !!(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET &&
    process.env.R2_PUBLIC_URL
  );
}

let cliente = null;
function getCliente() {
  if (!cliente) {
    cliente = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId:     process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return cliente;
}

/* Extensión permitida según el tipo de archivo que sube el navegador
   (siempre imágenes — evidencia fotográfica) */
const TIPOS_PERMITIDOS = {
  'image/jpeg': 'jpg',
  'image/png':  'png',
  'image/webp': 'webp',
};

/* Carpetas del bucket, una por clase de foto */
const CARPETAS = ['productos', 'evidencias', 'devoluciones', 'devoluciones-tienda', 'entregas', 'cambios', 'intentos'];

/* Genera una URL firmada de subida (PUT) válida por 5 minutos, y la
   URL pública final donde va a quedar la foto una vez subida.
   ordenId se usa para armar una ruta legible dentro del bucket, y
   carpeta separa los tipos de foto (ver CARPETAS: 'evidencias' para
   el medio de pago, 'productos' para la foto que se toma al crear la
   orden, 'devoluciones' y 'devoluciones-tienda' para las fotos de
   devolución, 'entregas', 'cambios' e 'intentos' para las que toma el
   motorizado al cerrar la orden). Una carpeta desconocida cae en
   'evidencias'.
   Si viene idSubida (la cola de fotos del celular), el nombre del
   archivo sale de ese id: así cada reintento de la misma foto pisa
   el mismo objeto en vez de dejar copias huérfanas en el bucket. */
async function generarUrlSubidaEvidencia(ordenId, contentType, carpeta, idSubida) {
  const ext = TIPOS_PERMITIDOS[contentType];
  if (!ext) {
    throw new Error('Tipo de imagen no permitido (usa JPEG, PNG o WEBP)');
  }

  const prefijo = CARPETAS.includes(carpeta) ? carpeta : 'evidencias';
  const base = idSubida || `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const nombreArchivo = `${prefijo}/orden-${parseInt(ordenId, 10)}/${base}.${ext}`;

  const comando = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET,
    Key: nombreArchivo,
    ContentType: contentType,
  });

  const uploadUrl = await getSignedUrl(getCliente(), comando, { expiresIn: 300 });
  const publicUrl = `${process.env.R2_PUBLIC_URL.replace(/\/$/, '')}/${nombreArchivo}`;

  return { uploadUrl, publicUrl };
}

/* true si la URL es una foto de NUESTRO bucket y de ESA orden. Evita
   que un cliente registre como evidencia una URL cualquiera. */
function esUrlDeOrden(url, ordenId) {
  if (!r2Habilitado() || typeof url !== 'string') return false;
  const base = process.env.R2_PUBLIC_URL.replace(/\/$/, '');
  const id   = parseInt(ordenId, 10);
  return CARPETAS.some((c) => url.startsWith(`${base}/${c}/orden-${id}/`));
}

module.exports = { r2Habilitado, generarUrlSubidaEvidencia, esUrlDeOrden, TIPOS_PERMITIDOS };
