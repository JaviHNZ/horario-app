# Backend · Claudia Netella Gestor de Horarios

API REST en Node.js/Express que da soporte al gestor de horarios: recibe imágenes de horarios manuscritos, las analiza con Google Gemini, valida los resultados contra MySQL, guarda los días y expone la gestión de casas, trabajadores e historial.

---

## Índice

- [Stack](#stack)
- [Estructura](#estructura)
- [Configuración](#configuración)
- [Puesta en marcha](#puesta-en-marcha)
- [Scripts](#scripts)
- [Base de datos](#base-de-datos)
- [API](#api)
- [Reglas de negocio](#reglas-de-negocio)
- [Integración con Gemini](#integración-con-gemini)
- [Manejo de errores](#manejo-de-errores)
- [Seguridad](#seguridad)
- [Limitaciones y deuda técnica](#limitaciones-y-deuda-técnica)

---

## Stack

| Dependencia | Uso |
| --- | --- |
| `express` 5 | Framework HTTP. |
| `mysql2` | Pool de conexiones y consultas preparadas. |
| `multer` | Subida de imágenes a `uploads/`. |
| `@google/genai` | Análisis de imágenes con Gemini. |
| `pdfkit` | Generación de PDF de facturas (aplazado). |
| `cors` | CORS abierto. |
| `dotenv` | Carga de `.env`. |
| `exceljs` (dev) | Lectura de Excel en scripts de importación. |
| `nodemon` (dev) | Recarga en desarrollo. |

---

## Estructura

```
backend/
├── server.js                  # Punto de entrada; carga .env y escucha el puerto
├── src/
│   ├── app.js                 # App Express y montaje de rutas
│   ├── config/
│   │   └── db.js              # Pool mysql2 (dateStrings: true)
│   ├── data/
│   │   ├── casas.js           # Listas auxiliares
│   │   └── trabajadores.js
│   ├── router/
│   │   ├── horarios.routes.js # Análisis, validación, guardado e historial
│   │   ├── casas.routes.js    # CRUD de casas
│   │   ├── trabajadores.routes.js # CRUD y resúmenes
│   │   └── facturas.routes.js # Facturación (aplazada)
│   └── services/
│       └── gemini.service.js  # Prompt y llamada a Gemini
├── scripts/
│   ├── migrar-esquema-casas.js
│   ├── importar-datos-reales.js
│   └── 03-importar-inicial.js
└── README.md
```

---

## Configuración

Crea `backend/.env` (no se versiona):

```env
DB_HOST=localhost
DB_USER=tu_usuario
DB_PASSWORD=tu_contraseña
DB_NAME=horarios_app
DB_PORT=3306
GOOGLE_API_KEY=tu_api_key
```

| Variable | Obligatoria | Descripción |
| --- | --- | --- |
| `DB_HOST` | Sí | Host de MySQL. |
| `DB_USER` | Sí | Usuario de MySQL. |
| `DB_PASSWORD` | Sí | Contraseña. |
| `DB_NAME` | Sí | Base de datos. |
| `DB_PORT` | Sí | Puerto. |
| `GOOGLE_API_KEY` | Sí para `/analizar` | API key de Gemini. |
| `PORT` | No | Puerto HTTP; por defecto `3000`. |

> `server.js` ejecuta `require("dotenv").config()`, por lo que el `.env` debe estar en el directorio desde el que se arranca el proceso.

---

## Puesta en marcha

```bash
cd backend
npm install
npm run dev      # nodemon server.js
# o
npm start        # node server.js
```

El servidor queda en `http://localhost:3000`.

### Importante: directorio de trabajo

Multer guarda las imágenes en `uploads/` **relativo al directorio actual del proceso**. Arranca siempre desde `backend/`:

```bash
cd backend
npm start        # ✅ las imágenes van a backend/uploads/
```

Si arrancas desde la raíz del repositorio, se creará otro `uploads/` en la raíz.

### Comprobar la base de datos

```bash
node test-db.js
```

---

## Scripts

Todos se ejecutan desde `backend/` y por defecto funcionan en **modo simulación**. Solo escriben con `--ejecutar`.

| Script | Descripción |
| --- | --- |
| `node scripts/migrar-esquema-casas.js` | Añade columnas del esquema real. Idempotente: omite las que ya existen. |
| `node scripts/importar-datos-reales.js` | Lee los Excel de `datos_reales/` y genera artefactos de revisión en `datos_reales/_salida/`. No toca MySQL. |
| `node scripts/03-importar-inicial.js` | Importación inicial transaccional: sustituye los datos ficticios por los reales. |

`npm test` es un placeholder sin pruebas reales.

---

## Base de datos

Base: `horarios_app` — MySQL 8, InnoDB, `utf8mb4_unicode_ci`.

### Esquema completo

```sql
CREATE TABLE `casas` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `nombre` varchar(150) NOT NULL,
  `nombre_cliente` varchar(150) DEFAULT NULL,
  `apellidos_cliente` varchar(150) DEFAULT NULL,
  `direccion` varchar(255) DEFAULT NULL,
  `contacto` varchar(20) DEFAULT NULL,
  `codigo_postal` varchar(10) DEFAULT NULL,
  `poblacion` varchar(100) DEFAULT NULL,
  `tipo` varchar(30) DEFAULT NULL,
  `frecuencia_texto` varchar(50) DEFAULT NULL,
  `visitas_por_periodo` tinyint unsigned DEFAULT NULL,
  `periodo_dias` smallint unsigned DEFAULT NULL,
  `precio_hora` decimal(6,2) DEFAULT NULL,
  `emite_factura` tinyint(1) NOT NULL DEFAULT '0',
  `observaciones` text,
  `datos_pendientes` tinyint(1) NOT NULL DEFAULT '0',
  `duracion_minutos` smallint unsigned DEFAULT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT '1',
  `fecha_creacion` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `fecha_actualizacion` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `nombre` (`nombre`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `dias` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `fecha` date NOT NULL,
  `nombre_archivo` varchar(255) DEFAULT NULL,
  `imagen_path` varchar(500) DEFAULT NULL,
  `estado` enum('pendiente','revisado','confirmado') NOT NULL DEFAULT 'pendiente',
  `fecha_creacion` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `fecha` (`fecha`),
  KEY `idx_dias_fecha` (`fecha`),
  KEY `idx_dias_estado` (`estado`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `trabajadores` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `nombre` varchar(100) NOT NULL,
  `apellidos` varchar(150) DEFAULT NULL,
  `contacto` varchar(20) DEFAULT NULL,
  `direccion` varchar(255) DEFAULT NULL,
  `poblacion` varchar(100) DEFAULT NULL,
  `datos_pendientes` tinyint(1) NOT NULL DEFAULT '0',
  `codigo` varchar(10) NOT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT '1',
  `fecha_creacion` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `fecha_actualizacion` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `codigo` (`codigo`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `horarios` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `dia_id` int unsigned NOT NULL,
  `casa_id` int unsigned NOT NULL,
  `hora_inicio` time NOT NULL,
  `hora_fin` time NOT NULL,
  `fecha_creacion` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `duracion_facturable_minutos` smallint unsigned DEFAULT NULL
    COMMENT 'Duración facturable excepcional de esta visita, en minutos. NULL = usar duración habitual de la casa',
  PRIMARY KEY (`id`),
  KEY `idx_horarios_dia` (`dia_id`),
  KEY `idx_horarios_casa` (`casa_id`),
  CONSTRAINT `fk_horario_casa` FOREIGN KEY (`casa_id`) REFERENCES `casas` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_horario_dia` FOREIGN KEY (`dia_id`) REFERENCES `dias` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `horario_trabajadores` (
  `horario_id` int unsigned NOT NULL,
  `trabajador_id` int unsigned NOT NULL,
  PRIMARY KEY (`horario_id`,`trabajador_id`),
  KEY `fk_ht_trabajador` (`trabajador_id`),
  CONSTRAINT `fk_ht_horario` FOREIGN KEY (`horario_id`) REFERENCES `horarios` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ht_trabajador` FOREIGN KEY (`trabajador_id`) REFERENCES `trabajadores` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `facturas` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `numero_factura` varchar(50) DEFAULT NULL,
  `casa_id` int unsigned NOT NULL,
  `fecha_inicio_periodo` date NOT NULL,
  `fecha_fin_periodo` date NOT NULL,
  `fecha_emision` date DEFAULT NULL,
  `nombre_cliente` varchar(150) NOT NULL,
  `direccion_cliente` varchar(255) DEFAULT NULL,
  `nombre_emisor` varchar(150) DEFAULT NULL,
  `identificacion_emisor` varchar(50) DEFAULT NULL,
  `direccion_emisor` varchar(255) DEFAULT NULL,
  `horas_totales_minutos` int unsigned NOT NULL DEFAULT '0',
  `precio_por_hora` decimal(10,2) NOT NULL DEFAULT '0.00',
  `base_imponible` decimal(10,2) NOT NULL DEFAULT '0.00',
  `porcentaje_impuesto` decimal(5,2) NOT NULL DEFAULT '0.00',
  `importe_impuesto` decimal(10,2) NOT NULL DEFAULT '0.00',
  `total` decimal(10,2) NOT NULL DEFAULT '0.00',
  `estado` enum('borrador','emitida','pagada','anulada') NOT NULL DEFAULT 'borrador',
  `observaciones` text,
  `fecha_creacion` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `fecha_actualizacion` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_facturas_numero` (`numero_factura`),
  KEY `idx_facturas_casa` (`casa_id`),
  KEY `idx_facturas_periodo` (`fecha_inicio_periodo`,`fecha_fin_periodo`),
  KEY `idx_facturas_estado` (`estado`),
  CONSTRAINT `fk_facturas_casa` FOREIGN KEY (`casa_id`) REFERENCES `casas` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_facturas_impuesto` CHECK (`porcentaje_impuesto` >= 0),
  CONSTRAINT `chk_facturas_periodo` CHECK (`fecha_fin_periodo` >= `fecha_inicio_periodo`),
  CONSTRAINT `chk_facturas_precio` CHECK (`precio_por_hora` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `factura_detalles` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `factura_id` int unsigned NOT NULL,
  `horario_id` int unsigned DEFAULT NULL,
  `fecha_servicio` date NOT NULL,
  `nombre_casa` varchar(150) NOT NULL,
  `descripcion` varchar(255) NOT NULL,
  `hora_inicio` time DEFAULT NULL,
  `hora_fin` time DEFAULT NULL,
  `duracion_facturable_minutos` smallint unsigned NOT NULL,
  `precio_por_hora` decimal(10,2) NOT NULL,
  `importe` decimal(10,2) NOT NULL,
  `fecha_creacion` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_factura_detalles_factura` (`factura_id`),
  KEY `idx_factura_detalles_horario` (`horario_id`),
  CONSTRAINT `fk_factura_detalles_factura` FOREIGN KEY (`factura_id`) REFERENCES `facturas` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_factura_detalles_horario` FOREIGN KEY (`horario_id`) REFERENCES `horarios` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### Relaciones

```
casas 1 ──── N horarios N ──── N trabajadores
  │                │
  │                └── 1 ──── N factura_detalles
  └── 1 ──── N facturas 1 ──── N factura_detalles

dias 1 ──── N horarios   (ON DELETE CASCADE)
```

### Notas

- No hay archivos de migración versionados en el repositorio; el esquema debe crearse manualmente.
- `dateStrings: true` en el pool evita desfases de zona horaria en `DATE` y `TIME`.
- `dias.fecha` es única: solo puede existir un registro por fecha.

---

## API

Base: `http://localhost:3000/api`

### Salud

| Método | Ruta | Descripción |
| --- | --- | --- |
| `GET` | `/health` | `{ ok: true, messange: "api funcioonando" }` |
| `GET` | `/` | Texto de comprobación. |

### Horarios

| Método | Ruta | Descripción |
| --- | --- | --- |
| `POST` | `/horarios/analizar` | `multipart/form-data` con campo `imagen`. Analiza con Gemini y valida contra MySQL. |
| `POST` | `/horarios/validar` | Valida un array de servicios sin guardar. |
| `POST` | `/horarios/guardar-completo` | Guarda un día completo de forma transaccional. |
| `GET` | `/horarios/historial` | Lista los días con número de servicios. |
| `GET` | `/horarios/historial/:diaId` | Detalle de un día. |
| `PATCH` | `/horarios/:id/duracion-facturable` | Ajusta la duración facturable de una visita. |
| `POST` | `/horarios/guardar` | Guardado heredado de un único servicio. |
| `GET/POST` | `/horarios/casas` | CRUD heredado de casas (sin uso desde la UI). |
| `GET/POST` | `/horarios/trabajadores` | CRUD heredado de trabajadores (sin uso desde la UI). |

#### `POST /horarios/analizar`

Respuesta:

```json
{
  "ok": true,
  "imagen": { "nombre_original": "horario.jpg" },
  "servicios": [
    {
      "casa": {
        "nombre": "CARMEN",
        "encontrada": true,
        "datos": { "id": 12, "nombre": "CARMEN", "duracion_minutos": 90, "activo": 1 }
      },
      "hora_inicio": "08:00",
      "hora_fin": "10:00",
      "trabajadores": [
        { "encontrado": true, "trabajador": { "id": 3, "nombre": "Ana", "codigo": "AN", "activo": 1 } },
        { "encontrado": false, "codigo": "XX" }
      ]
    }
  ]
}
```

Errores habituales:

- `400` — no se envió imagen, o no hay casas/trabajadores activos.
- `500` — fallo de Gemini o formato inválido.

#### `POST /horarios/validar`

Cuerpo:

```json
{
  "servicios": [
    { "casa": "CARMEN", "hora_inicio": "08:00", "hora_fin": "10:00", "trabajadores": ["AN"] }
  ]
}
```

#### `POST /horarios/guardar-completo`

Cuerpo:

```json
{
  "fecha": "2026-11-01",
  "imagen_original": "horario.jpg",
  "servicios": [
    {
      "casa_id": 12,
      "hora_inicio": "08:00",
      "hora_fin": "10:00",
      "trabajadores": [{ "id": 3 }]
    }
  ]
}
```

Comportamiento:

- Valida `fecha` y que haya servicios.
- Exige que **todos** los servicios tengan `casa_id` y horas.
- Si el día ya existe, **reemplaza** sus horarios (borra y vuelve a insertar).
- Antes de reemplazar, comprueba que ninguna visita del día esté incluida en una factura; si es así devuelve `409`.
- Todo ocurre en una transacción.

### Casas

| Método | Ruta | Descripción |
| --- | --- | --- |
| `GET` | `/casas` | Lista todas las casas con `campos_faltantes`. |
| `POST` | `/casas` | Crea una casa. |
| `PUT` | `/casas/:id` | Actualiza una casa. |
| `PATCH` | `/casas/:id/activo` | Activa o desactiva. |
| `DELETE` | `/casas/:id` | Elimina si no tiene horarios ni facturas; si los tiene, `409`. |
| `GET` | `/casas/resumen-facturacion?mes=&anio=` | Resumen facturable por casa. |
| `GET` | `/casas/:id/visitas?mes=&anio=` | Visitas de una casa en un periodo. |

Campos aceptados: `nombre` (obligatorio, único), `nombre_cliente`, `apellidos_cliente`, `direccion`, `contacto`, `codigo_postal`, `poblacion`, `tipo`, `frecuencia_texto`, `visitas_por_periodo`, `periodo_dias`, `precio_hora`, `emite_factura`, `observaciones`, `duracion_minutos`, `activo`.

### Trabajadores

| Método | Ruta | Descripción |
| --- | --- | --- |
| `GET` | `/trabajadores` | Lista todos los trabajadores. |
| `POST` | `/trabajadores` | Crea un trabajador. |
| `PUT` | `/trabajadores/:id` | Actualiza datos sin borrar historial. |
| `PATCH` | `/trabajadores/:id/activo` | Activa o desactiva. |
| `GET` | `/trabajadores/resumen-diario?fecha=YYYY-MM-DD` | Minutos trabajados por trabajador activo. |
| `GET` | `/trabajadores/:id/perfil?mes=&anio=&desde=&hasta=` | Perfil y actividad del trabajador. |

Campos: `nombre` y `codigo` obligatorios; `apellidos`, `contacto`, `direccion`, `poblacion` opcionales. El código se normaliza a mayúsculas.

### Facturas (aplazado)

| Método | Ruta | Descripción |
| --- | --- | --- |
| `GET` | `/facturas?casa_id=&estado=` | Lista facturas. |
| `GET` | `/facturas/:id` | Detalle. |
| `POST` | `/facturas/borrador` | Crea un borrador a partir de visitas. |
| `PUT` | `/facturas/:id` | Edita un borrador. |
| `DELETE` | `/facturas/:id` | Elimina un borrador. |
| `POST` | `/facturas/:id/emitir` | Emite la factura. |
| `PATCH` | `/facturas/:id/estado` | Cambia el estado. |
| `GET` | `/facturas/:id/pdf` | Descarga el PDF. |

---

## Reglas de negocio

### Datos pendientes

Se calculan **siempre en el servidor**, nunca se confía en lo que envía el navegador.

- **Casas** (`datos_pendientes = 1`) si falta cualquiera de:
  `nombre_cliente`, `contacto`, `direccion`, `frecuencia_texto`, `precio_hora`, `duracion_minutos`.
- **Trabajadores** (`datos_pendientes = 1`) si falta cualquiera de:
  `apellidos`, `contacto`, `direccion`, `poblacion`.

La API devuelve además `campos_faltantes` en las casas para que la interfaz pueda mostrarlos.

### Validación de análisis

- Solo se ofrecen a Gemini las casas y los códigos **activos**.
- La comparación de casa ignora mayúsculas y espacios (`LOWER(TRIM(...))`).
- La comparación de código ignora mayúsculas y espacios (`UPPER(TRIM(...))`).
- Un servicio puede guardarse con trabajadores no encontrados, pero la UI los marca.

### Eliminación

- **Casa:** `DELETE` devuelve `409` si tiene horarios o facturas; se ofrece desactivarla.
- **Trabajador:** no se borra; se desactiva para conservar el historial.

### Reemplazo de un día

`guardar-completo` reemplaza el contenido del día. Si alguna visita del día ya pertenece a una factura (en cualquier estado), se bloquea con `409` para no romper la facturación.

---

## Integración con Gemini

`src/services/gemini.service.js`:

- Modelo: `gemini-3.5-flash-lite`.
- Lee la imagen, la envía en base64 y pide **solo JSON**.
- El prompt incluye la lista de casas y códigos válidos y prohíbe inventar valores.
- Fuerza `responseMimeType: "application/json"`.
- Limpia bloques Markdown ```json ... ``` antes de `JSON.parse`.

Formato esperado:

```json
{
  "servicios": [
    { "casa": "CARMEN", "hora_inicio": "08:00", "hora_fin": "10:00", "trabajadores": ["JE"] }
  ]
}
```

> El modelo está fijado en el código. Si cambia de disponibilidad, hay que editarlo.

---

## Manejo de errores

- Las rutas responden con `{ ok: false, error: "..." }`.
- Códigos usados: `400` (validación), `404` (no encontrado), `409` (conflicto), `500` (error interno).
- Las transacciones hacen `rollback` ante cualquier fallo.
- Los errores se registran en consola con `console.error`.

---

## Seguridad

- `backend/.env` **nunca** se versiona.
- `uploads/`, `backups/` y `datos_reales/` están ignorados por Git.
- No hay autenticación, autorización ni límite de tasa.
- CORS está abierto a cualquier origen.
- Las imágenes no se borran tras el análisis.

---

## Limitaciones y deuda técnica

- Sin tests ni CI.
- Endpoints CRUD duplicados de casas y trabajadores en `horarios.routes.js`; conviene eliminarlos o unificarlos.
- `const { response } = require("../app")` en `gemini.service.js` es residual e inofensivo.
- `config: { responseMimeType }` está anidado dentro de `contents` en la llamada a Gemini; funciona, pero no es la ubicación documentada.
- El modelo de Gemini está hardcodeado.
- No se limpian las imágenes de `uploads/`.
- Sin validación de tamaño/tipo de archivo más allá de lo que aporta multer.
- `npm test` no ejecuta pruebas.
- El esquema no está versionado.
