# Kueski Smart Widget

Extensión de Chrome (Manifest V3) que funciona como asistente financiero mientras compras en línea. Detecta si estás en una tienda afiliada a Kueski Pay, lee el producto o carrito de la página y te muestra cupones, opciones de pago a quincenas, préstamos y el estado de tu cuenta.

> Prototipo académico desarrollado en equipo. No es un producto oficial de Kueski.

## Funcionalidades

**En la página de la tienda**
- Banner que avisa cuando la tienda está afiliada.
- Detección del producto que estás viendo (nombre y precio) y del total del carrito.

**En el popup de la extensión**
- Pago a quincenas del producto o del carrito completo detectado en la página.
- Tiendas afiliadas por categoría (moda, electrónica, hogar, deportes) y sus cupones de descuento.
- Saldo disponible, crédito usado y recordatorios de pagos.
- Tarjeta virtual Kueski con CVV dinámico.
- Historial de compras, transferencias y préstamos, con el detalle de cada cuota.
- Préstamo personal (Kueski Cash), transferencias y enlaces favoritos.
- Tres usuarios demo con distinto historial crediticio (bueno, regular y limitado), que habilitan o bloquean funciones según su perfil.

## Tecnologías

| Parte | Tecnologías |
| --- | --- |
| Extensión | JavaScript, HTML y CSS, Chrome Extensions Manifest V3 (popup, content script y service worker) |
| Backend | Node.js, Express, PostgreSQL (`pg`) |

## Estructura

```text
manifest.json        Configuración de la extensión
popup.html/.js/.css  Interfaz del popup (login, onboarding y app)
content.js/.css      Script que se inyecta en las tiendas: detecta producto y carrito y muestra el banner
background.js        Service worker: comunica la página con el popup
backend/
  src/server.js      API REST
  src/demoProfiles.js  Usuarios demo y reglas por perfil crediticio
  src/db.js          Conexión a PostgreSQL
  sql/schema.sql     Esquema de la base de datos
```

## Puesta en marcha

### 1. Base de datos

Crea una base de datos PostgreSQL y carga el esquema, que incluye tiendas, cupones y planes de pago de ejemplo:

```bash
createdb kueski_widget
psql -d kueski_widget -f backend/sql/schema.sql
```

### 2. Backend

```bash
cd backend
npm install
cp .env.example .env    # ajusta los datos de conexión
npm run dev
```

La API queda en http://localhost:3000. Al arrancar crea los usuarios demo.

### 3. Extensión

1. Abre `chrome://extensions` y activa el **Modo de desarrollador**.
2. Pulsa **Cargar descomprimida** y selecciona la carpeta raíz del repositorio.
3. Abre el popup e inicia sesión con un usuario demo.

## Usuarios demo

| Usuario | Perfil | Correo | Contraseña |
| --- | --- | --- | --- |
| Ana | Buen crédito | `bueno@demo.com` | `Kueski2026` |
| Luis | Crédito regular | `regular@demo.com` | `Kueski2026` |
| María | Crédito limitado | `limitado@demo.com` | `Kueski2026` |

## API principal

| Método | Ruta | Descripción |
| --- | --- | --- |
| `POST` | `/api/login`, `/api/register` | Inicio de sesión y registro |
| `GET` | `/api/cuenta` | Saldo, crédito y perfil |
| `GET` | `/api/merchants/check` | Indica si un dominio es tienda afiliada |
| `GET` | `/api/cupones/check`, `/api/cupones/tiendas` | Cupones por tienda |
| `GET` | `/api/planes` | Planes de pago |
| `POST` | `/api/transacciones` | Registra una compra |
| `GET` | `/api/recordatorios` | Próximos pagos |
| `POST` | `/api/recordatorios/pagar` | Paga una cuota |
| `POST` | `/api/prestamo-personal` | Solicita un préstamo |
| `POST` | `/api/transferencias` | Envía una transferencia |
| `GET` | `/api/tarjeta` | Datos de la tarjeta virtual |
| `GET`, `POST`, `DELETE` | `/api/favoritos` | Enlaces favoritos |
| `POST` | `/api/demo/reset` | Restablece los usuarios demo |

## Equipo

Proyecto en equipo del Tecnológico de Monterrey. Repositorio mantenido por [Diego Delgado](https://github.com/diegodelgadog6).
