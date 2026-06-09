# Velox Courier — Instrucciones para conectar SQL Server

## PASO 1: Ejecutar el SQL en SSMS

1. Abre **SQL Server Management Studio**
2. Conéctate a tu servidor (`DESKTOP-ERVF8UO`)
3. Click en **New Query**
4. Abre el archivo `velox_sqlserver.sql`
5. Ejecuta todo (F5)
6. Verifica que aparezca `velox_courier` en Databases

---

## PASO 2: Configurar la conexión

Abre el archivo `.env` y cambia `DB_SERVER` por el nombre
exacto que ves en SSMS al conectarte:

```
DB_SERVER=DESKTOP-ERVF8UO   ← el tuyo ya está aquí
DB_DATABASE=velox_courier
DB_PORT=1433
PORT=3000
```

---

## PASO 3: Instalar dependencias Node

Abre una terminal en la carpeta `server/` y ejecuta:

```bash
npm install
```

---

## PASO 4: Iniciar el servidor

```bash
node server.js
```

Deberías ver:
```
✅ Conectado a SQL Server: DESKTOP-ERVF8UO
🚀 Velox Courier API corriendo en http://localhost:3000
📂 Frontend en: http://localhost:3000/index.html
```

---

## PASO 5: Abrir el sistema

En lugar de abrir `index.html` directamente con Live Server,
ahora abre el navegador y ve a:

```
http://localhost:3000/index.html
```

---

## Si hay error de conexión

El error más común es la autenticación. Si falla, abre `db.js`
y cambia el bloque `authentication` por este:

```javascript
// Autenticación SQL Server (usuario y contraseña)
authentication: {
  type: 'default',
  options: {
    userName: 'sa',       // tu usuario SQL
    password: 'tu_clave', // tu contraseña
  }
}
```

---

## Estructura de carpetas

```
courier-velox/
├── css/
├── js/             ← frontend (ya actualizado)
├── pages/
├── img/
├── index.html
└── server/         ← NUEVO
    ├── server.js
    ├── db.js
    ├── .env
    ├── package.json
    └── routes/
        ├── ordenes.js
        ├── motorizados.js
        ├── tiendas.js
        ├── tarifas.js
        └── caja.js
```
