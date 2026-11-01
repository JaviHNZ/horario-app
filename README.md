# Claudia Netella · Gestor de Horarios

Aplicación web para digitalizar los horarios de trabajo manuscritos de la empresa **Claudia Netella**. El usuario sube una foto del horario, una IA (Google Gemini) extrae los servicios y la aplicación valida cada casa y cada trabajador contra la base de datos MySQL antes de permitir guardarlo. Después se pueden consultar, editar y revisar los horarios históricos.

El proyecto está dividido en dos aplicaciones independientes:

- **`frontend/`** — interfaz React + Vite.
- **`backend/`** — API REST Express + MySQL + integración con Gemini.

> **Estado:** el módulo de horarios está operativo. El módulo de facturación existe en el código pero está **aplazado** y fuera de la navegación principal.

---

## Índice

- [Características](#características)
- [Arquitectura](#arquitectura)
- [Stack tecnológico](#stack-tecnológico)
- [Estructura del repositorio](#estructura-del-repositorio)
- [Requisitos previos](#requisitos-previos)
- [Puesta en marcha](#puesta-en-marcha)
- [Variables de entorno](#variables-de-entorno)
- [Base de datos](#base-de-datos)
- [Scripts disponibles](#scripts-disponibles)
- [Flujo de trabajo principal](#flujo-de-trabajo-principal)
- [API](#api)
- [Seguridad y privacidad](#seguridad-y-privacidad)
- [Limitaciones conocidas](#limitaciones-conocidas)
- [Roadmap](#roadmap)
- [Documentación adicional](#documentación-adicional)

---

## Características

### Horarios

- Subida de una imagen (JPG/PNG) del horario manuscrito.
- Análisis con Google Gemini usando como contexto las casas y los códigos de trabajador **activos** de MySQL.
- Validación automática de cada servicio extraído:
  - la casa debe existir en la tabla `casas`;
  - cada código de trabajador debe existir en `trabajadores`.
- Interfaz de revisión editable: fecha, horas, casa y trabajadores de cada servicio.
- Avisos de datos pendientes (casas o trabajadores con información incompleta).
- Guardado transaccional de todo el día (`dias` + `horarios` + `horario_trabajadores`).
- Protección contra sobrescribir un día que ya contiene visitas incluidas en una factura.
- Historial de días guardados con detalle de servicios y trabajadores.

### Gestión

- CRUD de **casas** con todos sus datos: cliente, contacto, dirección, población, frecuencia, precio/hora, duración de referencia, facturación, observaciones, etc.
- CRUD de **trabajadores**: nombre, apellidos, código, contacto, dirección y población.
- Resumen diario de **horas trabajadas** por trabajador, con total del día y navegación por fecha.
- Búsqueda y contadores en ambas listas.
- Activación/desactivación sin borrar historial.
- Eliminación segura de casas: solo se permite si no tienen horarios ni facturas asociados.

### Historial

- Listado de días con fecha, archivo original, estado y número de servicios.
- Detalle de cada día con sus servicios y trabajadores asignados.

### Facturación (aplazada)

El backend incluye endpoints para generar borradores de factura, emitirlas, cambiar su estado y descargar el PDF. El frontend conserva las vistas, pero **no forma parte de la navegación principal** y se considera trabajo futuro.

---

## Arquitectura

```
┌─────────────────────────┐        HTTP/JSON        ┌─────────────────────────┐
│  Frontend (React/Vite)  │ ──────────────────────▶ │  Backend (Express 5)    │
│  http://localhost:5173  │ ◀────────────────────── │  http://localhost:3000  │
└─────────────────────────┘                         └───────────┬─────────────┘
                                                                │
                                      ┌─────────────────────────┼─────────────────────────┐
                                      │                         │                         │
                                      ▼                         ▼                         ▼
                              ┌──────────────┐         ┌─────────────────┐       ┌─────────────────┐
                              │ MySQL        │         │ Google Gemini   │       │ uploads/        │
                              │ horarios_app │         │ (visión + JSON) │       │ imágenes       │
                              └──────────────┘         └─────────────────┘       └─────────────────┘
```

Flujo resumido:

1. El frontend envía la imagen a `POST /api/horarios/analizar` (multipart/form-data).
2. El backend guarda la imagen en `uploads/`, consulta casas y trabajadores activos y llama a Gemini.
3. Gemini devuelve JSON con los servicios detectados.
4. El backend valida cada servicio contra MySQL y responde con coincidencias y no encontrados.
5. El usuario revisa y corrige en la interfaz.
6. Al guardar, el frontend llama a `POST /api/horarios/guardar-completo`, que escribe todo en una transacción.

---

## Stack tecnológico

| Capa | Tecnología |
| --- | --- |
| Frontend | React 19, Vite 8, React Router 7, CSS plano |
| Backend | Node.js, Express 5, mysql2, multer, pdfkit |
| IA | `@google/genai` (modelo `gemini-3.5-flash-lite`) |
| Base de datos | MySQL (InnoDB, utf8mb4) |
| Herramientas | ESLint, nodemon, exceljs (scripts de importación) |

---

## Estructura del repositorio

```
horarios-app/
├── README.md
├── .gitignore
├── backend/
│   ├── server.js
│   ├── src/
│   │   ├── app.js
│   │   ├── config/db.js
│   │   ├── data/                 # listas auxiliares
│   │   ├── router/               # horarios, casas, trabajadores, facturas
│   │   └── services/             # integración con Gemini
│   ├── scripts/                  # migración e importación de datos
│   └── README.md
└── frontend/
    ├── index.html
    ├── src/
    │   ├── App.jsx               # casi toda la UI y el estado
    │   ├── App.css
    │   ├── main.jsx
    │   ├── TrabajadoresView.jsx  # vista heredada
    │   ├── FacturasView.jsx      # facturación (aplazada)
    │   └── FacturaDetalleView.jsx
    └── README.md
```

---

## Requisitos previos

- **Node.js 20+** y npm.
- **MySQL 8+** en ejecución.
- Una **API key de Google Gemini** con acceso al modelo configurado.
- Git (opcional, para clonar).

---

## Puesta en marcha

### 1. Clonar el repositorio

```bash
git clone git@github.com:JaviHNZ/horario-app.git
cd horario-app
```

### 2. Crear la base de datos

Crea la base `horarios_app` y sus tablas. El repositorio **no incluye migraciones automáticas**; el esquema de referencia está en [`backend/README.md`](backend/README.md#base-de-datos).

```sql
CREATE DATABASE horarios_app
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
```

### 3. Configurar el backend

```bash
cd backend
npm install
cp .env.example .env   # si no existe, créalo manualmente (ver abajo)
```

Crea `backend/.env` con:

```env
DB_HOST=localhost
DB_USER=tu_usuario
DB_PASSWORD=tu_contraseña
DB_NAME=horarios_app
DB_PORT=3306
GOOGLE_API_KEY=tu_api_key
```

Arranca el backend **desde `backend/`** para que las imágenes se guarden en `backend/uploads/`:

```bash
npm run dev     # nodemon
# o
npm start       # node
```

Comprueba que responde:

```bash
curl http://localhost:3000/api/health
```

### 4. Configurar el frontend

En otra terminal:

```bash
cd frontend
npm install
npm run dev
```

Abre `http://localhost:5173`.

> La URL de la API está fijada en `frontend/src/App.jsx` como `http://localhost:3000/api`. Si cambias el puerto del backend, actualízala.

---

## Variables de entorno

Todas las variables viven en `backend/.env` (no se versiona):

| Variable | Obligatoria | Descripción |
| --- | --- | --- |
| `DB_HOST` | Sí | Host de MySQL. |
| `DB_USER` | Sí | Usuario de MySQL. |
| `DB_PASSWORD` | Sí | Contraseña de MySQL. |
| `DB_NAME` | Sí | Nombre de la base (`horarios_app`). |
| `DB_PORT` | Sí | Puerto de MySQL (normalmente `3306`). |
| `GOOGLE_API_KEY` | Sí para analizar | API key de Google Gemini. |
| `PORT` | No | Puerto del backend. Por defecto `3000`. |

El frontend no usa variables de entorno.

---

## Base de datos

Tablas principales:

| Tabla | Propósito |
| --- | --- |
| `casas` | Catálogo de casas/clientes y sus condiciones de servicio. |
| `trabajadores` | Catálogo de trabajadores con código único. |
| `dias` | Un registro por fecha analizada/guardada. |
| `horarios` | Servicios (casa + hora inicio/fin) de cada día. |
| `horario_trabajadores` | Relación N:M entre servicios y trabajadores. |
| `facturas` | Cabeceras de factura (módulo aplazado). |
| `factura_detalles` | Líneas de factura (módulo aplazado). |

Restricciones clave:

- `casas.nombre` es **único**.
- `trabajadores.codigo` es **único**.
- `dias.fecha` es **único**.
- Borrar un `dias` elimina en cascada sus `horarios` y sus `horario_trabajadores`.
- Borrar una casa o un trabajador referenciado está **restringido**.

El DDL completo y las relaciones están en [`backend/README.md`](backend/README.md#base-de-datos).

---

## Scripts disponibles

### Backend (desde `backend/`)

| Comando | Descripción |
| --- | --- |
| `npm run dev` | Servidor con recarga automática (nodemon). |
| `npm start` | Servidor en modo normal. |
| `node test-db.js` | Comprueba la conexión a MySQL. |
| `node scripts/migrar-esquema-casas.js` | Añade columnas del esquema real (simulación por defecto; `--ejecutar` aplica). |
| `node scripts/importar-datos-reales.js` | Vista previa de la importación desde Excel (no toca la BD). |
| `node scripts/03-importar-inicial.js` | Importación inicial transaccional (`--ejecutar` para aplicar). |

### Frontend (desde `frontend/`)

| Comando | Descripción |
| --- | --- |
| `npm run dev` | Servidor de desarrollo Vite. |
| `npm run build` | Build de producción en `dist/`. |
| `npm run preview` | Sirve el build de producción. |
| `npm run lint` | ESLint. |

---

## Flujo de trabajo principal

1. **Analizar** — sube una foto del horario.
2. **Revisar** — corrige fecha, horas, casas y trabajadores; la interfaz marca lo que no se pudo validar.
3. **Guardar** — se crea o reemplaza el día completo de forma transaccional.
4. **Historial** — consulta los días guardados y su detalle.
5. **Gestión** — mantén actualizados casas y trabajadores.

---

## API

Resumen de endpoints (detalle completo en [`backend/README.md`](backend/README.md#api)):

| Método | Ruta | Descripción |
| --- | --- | --- |
| `GET` | `/api/health` | Estado de la API. |
| `POST` | `/api/horarios/analizar` | Analiza una imagen con Gemini. |
| `POST` | `/api/horarios/validar` | Valida servicios contra la BD. |
| `POST` | `/api/horarios/guardar-completo` | Guarda un día completo. |
| `GET` | `/api/horarios/historial` | Lista los días guardados. |
| `GET` | `/api/horarios/historial/:diaId` | Detalle de un día. |
| `GET/POST/PUT/PATCH/DELETE` | `/api/casas` | CRUD de casas. |
| `GET/POST/PUT/PATCH` | `/api/trabajadores` | CRUD de trabajadores. |
| `GET` | `/api/trabajadores/resumen-diario` | Minutos trabajados por día. |
| `GET` | `/api/trabajadores/:id/perfil` | Perfil y actividad de un trabajador. |
| `*` | `/api/facturas` | Facturación (aplazada). |

---

## Seguridad y privacidad

- `backend/.env` contiene credenciales reales y **nunca** debe subirse al repositorio.
- `uploads/`, `backups/` y `datos_reales/` están ignorados en Git porque contienen imágenes y datos personales (nombres, teléfonos, direcciones).
- No hay autenticación ni autorización: la API está pensada para uso local.
- CORS está completamente abierto (`cors()`), adecuado solo en desarrollo.
- Las imágenes subidas **no se eliminan** automáticamente.

---

## Limitaciones conocidas

- Sin tests automatizados ni CI.
- Sin autenticación de usuarios.
- URL de API fijada en el código del frontend.
- CORS abierto y sin límites de tasa.
- Las imágenes de `uploads/` se acumulan.
- Existen endpoints CRUD duplicados de casas y trabajadores dentro de `horarios.routes.js` (heredados, sin uso desde la interfaz).
- El módulo de facturación está implementado en backend pero aplazado en la interfaz.
- El esquema de base de datos no se versiona; debe crearse manualmente.

---

## Roadmap

- [ ] Terminar y publicar el módulo de facturación.
- [ ] Añadir autenticación y roles.
- [ ] Externalizar la URL de la API y el modelo de Gemini a variables de entorno.
- [ ] Limpieza automática de imágenes antiguas.
- [ ] Tests de integración del flujo analizar → revisar → guardar.
- [ ] Migraciones de base de datos versionadas.

---

## Documentación adicional

- [`backend/README.md`](backend/README.md) — configuración, esquema completo, API y reglas de negocio.
- [`frontend/README.md`](frontend/README.md) — rutas, componentes, estado y estilos.

---

Hecho para **Claudia Netella**.
