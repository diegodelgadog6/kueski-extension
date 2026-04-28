Implementacion de base de datos para el prototipo

Arquitectura
1. Extension Chrome
2. API Node.js local en http://localhost:3000
3. PostgreSQL local

Archivos agregados
1. backend/package.json
2. backend/.env.example
3. backend/src/db.js
4. backend/src/server.js
5. backend/sql/schema.sql

Cambios en la extension
1. manifest.json agrega host_permissions para http://localhost:3000/*
2. background.js consulta la API para validar comercios y tiene fallback local
3. background.js registra actividad en API
4. content.js envia eventos de actividad al background

Paso 1: Crear base de datos en pgAdmin
1. Abrir pgAdmin
2. Crear base de datos con nombre kueski_widget
3. Abrir Query Tool y ejecutar todo el contenido de backend/sql/schema.sql

Paso 2: Configurar backend
1. Ir a carpeta backend
2. Copiar .env.example a .env
3. Editar .env con tus datos reales de postgres

Variables esperadas
PORT=3000
DB_HOST=localhost
DB_PORT=5432
DB_NAME=kueski_widget
DB_USER=postgres
DB_PASSWORD=tu_password

Paso 3: Instalar y correr API
1. Ejecutar npm install en carpeta backend
2. Ejecutar npm run dev
3. Validar en navegador: http://localhost:3000/health

Respuesta esperada aproximada
{"ok":true,"db":"connected"}

Paso 4: Recargar extension
1. Ir a chrome://extensions
2. Activar modo desarrollador
3. Presionar Reload en Kueski Smart Widget

Paso 5: Probar flujo completo
1. Abrir un sitio afiliado como amazon.com.mx
2. Verificar banner con cupon
3. Copiar cupon
4. Revisar en PostgreSQL la tabla user_activity

Consulta util para clase
SELECT ua.id, ua.action, ua.details, ua.created_at, m.name AS merchant
FROM user_activity ua
LEFT JOIN merchants m ON m.id = ua.merchant_id
ORDER BY ua.created_at DESC
LIMIT 20;

Preguntas tipicas y respuesta corta
1. Por que no conectar extension directo a postgres
Porque expondrias credenciales y consultas SQL en cliente.

2. Donde esta la logica de negocio
En backend/src/server.js

3. Que pasa si backend no esta arriba
La extension cae a fallback local en background.js para no romper el demo.
