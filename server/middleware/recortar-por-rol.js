/* ============================================================
   middleware/recortar-por-rol.js
   Ni la tienda ni el motorizado tienen que poder calcular el margen de
   Velox (lo que paga la tienda − lo que se le paga al moto). Este filtro
   le saca a TODA respuesta JSON de la API, antes de salir, los campos que
   ese rol no debe recibir, a cualquier profundidad (órdenes, detalle de
   una orden, Caja, reasignaciones, listas…). Así una ruta nueva queda
   cubierta sin acordarse.
   · motorizado: nada de lo que paga la tienda (delivery y adicional) ni
     del valor del producto (cobrado − delivery lo delataría). Su pago,
     lo que cobró y su deuda siguen igual.
   · tienda: nada del pago al motorizado.
   · admin, operador y visor: todo, sin tocar.
   Si una pantalla del moto o de la tienda necesita uno de estos campos,
   la respuesta es NO mandárselo: la pantalla se adapta.
   ============================================================ */

const CAMPOS_PROHIBIDOS = {
  motorizado: new Set([
    'delivery_base', 'delivery_total', 'monto_adicional', 'monto_producto',
    'delivery',          /* caja.delivery de /motorizados/:id/ordenes */
    'precio_delivery', 'margen',
  ]),
  tienda: new Set([
    'pago_moto_base', 'pago_moto_adicional', 'pago_moto_total',
    'pago_moto', 'pago_motorizado', 'saldo_moto', 'margen',
  ]),
};

function esObjetoPlano(v) {
  return v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;
}

function limpiar(valor, prohibidos) {
  if (Array.isArray(valor)) return valor.map((v) => limpiar(v, prohibidos));
  if (!esObjetoPlano(valor)) return valor; /* fechas, Buffer, números, texto */
  const limpio = {};
  for (const [k, v] of Object.entries(valor)) {
    if (!prohibidos.has(k)) limpio[k] = limpiar(v, prohibidos);
  }
  return limpio;
}

/* El rol se lee al RESPONDER (requireAuth corre después, dentro de cada router) */
function recortarPorRol(req, res, next) {
  const json = res.json.bind(res);
  res.json = function (body) {
    const prohibidos = req.usuario && CAMPOS_PROHIBIDOS[req.usuario.rol];
    return json(prohibidos ? limpiar(body, prohibidos) : body);
  };
  next();
}

module.exports = { recortarPorRol, CAMPOS_PROHIBIDOS };
