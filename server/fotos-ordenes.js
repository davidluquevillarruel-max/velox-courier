/* ============================================================
   server/fotos-ordenes.js — las fotos de una lista de órdenes

   Para las tablas de órdenes de Clientes / Tiendas
   (GET /tiendas/:id/ordenes) y de Gestión / Motorizado
   (GET /motorizados/:id/ordenes): cada orden lleva
   fotos = [{ tipo, url }], en el orden en que se subieron.

   UNA sola consulta por pantalla, con el MISMO WHERE que la consulta
   de las órdenes (y los mismos parámetros, que salen del token): una
   tienda o un moto nunca recibe fotos de órdenes que no puede ver.
   Regla (25/11): si ves la orden, ves todas sus fotos (todos los
   tipos de ordenes_fotos), para todos los roles.
   ============================================================ */

/* whereOrdenes: el WHERE de la consulta de las órdenes, con alias "o"
   (ej. "o.id_tienda = @id AND o.estado <> 'anulado' AND …") */
function sqlFotosDeOrdenes(whereOrdenes) {
  return `
    SELECT f.id_orden, f.tipo, f.url
    FROM ordenes_fotos f
    JOIN ordenes o ON o.id = f.id_orden
    WHERE ${whereOrdenes} AND f.url <> ''
    ORDER BY f.id_orden, f.subido_en, f.id`;
}

/* recordset de sqlFotosDeOrdenes → Map(id_orden → [{ tipo, url }]) */
function agruparFotos(recordset) {
  const porOrden = new Map();
  recordset.forEach((f) => {
    const id = Number(f.id_orden);
    if (!porOrden.has(id)) porOrden.set(id, []);
    porOrden.get(id).push({ tipo: f.tipo, url: f.url });
  });
  return porOrden;
}

module.exports = { sqlFotosDeOrdenes, agruparFotos };
