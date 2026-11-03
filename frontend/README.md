# Frontend · Claudia Netella Gestor de Horarios

Interfaz web en React + Vite para subir fotos de horarios, revisar y corregir el resultado del análisis con IA, guardarlos y gestionar casas y trabajadores.

La aplicación consume la API del backend en `http://localhost:3000/api`.

---

## Índice

- [Stack](#stack)
- [Estructura](#estructura)
- [Puesta en marcha](#puesta-en-marcha)
- [Rutas](#rutas)
- [Vistas y componentes](#vistas-y-componentes)
- [Estado y flujo de datos](#estado-y-flujo-de-datos)
- [Consumo de la API](#consumo-de-la-api)
- [Estilos y diseño](#estilos-y-diseño)
- [Scripts](#scripts)
- [Calidad](#calidad)
- [Limitaciones](#limitaciones)

---

## Stack

| Dependencia | Uso |
| --- | --- |
| `react` 19 | UI. |
| `react-dom` 19 | Render. |
| `react-router-dom` 7 | Rutas del navegador. |
| `vite` 8 | Servidor de desarrollo y build. |
| `eslint` + plugins | Lint. |

No usa TypeScript, ni librería de estado, ni framework CSS.

---

## Estructura

```
frontend/
├── index.html               # Título: Claudia Netella · Gestor de Horarios
├── vite.config.js
├── src/
│   ├── main.jsx             # createRoot + BrowserRouter
│   ├── App.jsx              # Rutas, Layout y casi toda la lógica/UI
│   ├── App.css              # Estilos de la aplicación
│   ├── index.css            # Estilos base
│   ├── TrabajadoresView.jsx # Vista heredada de resumen/perfil
│   ├── FacturasView.jsx     # Facturación (aplazada)
│   └── FacturaDetalleView.jsx
└── README.md
```

`App.jsx` concentra deliberadamente el estado de las tres secciones principales (`Horarios`, `Gestión`, `Historial`) para que sobrevivan al cambiar de pestaña.

---

## Puesta en marcha

Requisitos: Node.js 20+ y el backend en marcha.

```bash
cd frontend
npm install
npm run dev
```

Abre `http://localhost:5173`.

### Backend

El frontend espera la API en `http://localhost:3000/api`. Para levantarla:

```bash
cd ../backend
npm run dev
```

> La URL está fijada en `src/App.jsx` (`const API_BASE = "http://localhost:3000/api";`). No hay proxy de Vite ni variable de entorno.

---

## Rutas

| Ruta | Componente | Descripción |
| --- | --- | --- |
| `/` | — | Redirige a `/horarios`. |
| `/horarios` | `HorariosView` | Análisis y revisión de horarios. |
| `/gestion` | `HorariosView` | Gestión de casas y trabajadores. |
| `/historial` | `HorariosView` | Historial de días guardados. |
| `/trabajadores` | `TrabajadoresView` | Vista heredada de resumen/perfil (fuera de la navegación). |
| `/trabajadores/:id` | `TrabajadoresView` | Perfil de trabajador (heredada). |
| `/facturas` | `FacturasView` | Facturación (aplazada, fuera de la navegación). |
| `/facturas/casas/:id` | `FacturasView` | Visitas de una casa (aplazada). |
| `/facturas/:id` | `FacturaDetalleView` | Detalle de factura (aplazada). |
| `*` | — | Redirige a `/horarios`. |

### Navegación principal

`Layout` muestra una cabecera blanca con:

- **Claudia Netella** como marca.
- Una etiqueta pequeña **Gestor de Horarios**.
- Las pestañas **Horarios**, **Gestión** e **Historial**.

Las tres rutas renderizan el mismo componente `HorariosView`, que decide qué sección mostrar según `location.pathname`. Así el estado del análisis no se pierde al cambiar de pestaña.

---

## Vistas y componentes

### `HorariosView` — sección Horarios

- Pestañas **Analizar** y **Revisar**.
- Selector de imagen con vista previa.
- Botón de análisis con estado de carga y mensajes de error.
- Tabla editable de servicios: fecha, casa, hora de inicio, hora de fin y trabajadores.
- Botón **Eliminar** en cada servicio, tanto en la vista normal como durante la edición.
- Botón **Añadir casa** para casas no registradas: crea la casa con su nombre y la vincula al servicio sin salir de la revisión.
- Botón **Escribir nombre** para dar de alta una casa manualmente (por ejemplo si la IA no la reconoce o la confunde); admite corregir el nombre y reutiliza la casa si ya existe.
- Botón **Cargar otra imagen** junto a **Guardar horario** para descartar la revisión y volver a subir una foto.
- Marca visualmente casas o trabajadores no encontrados y datos pendientes.
- Botón de guardado con feedback de éxito/error.

### `HorariosView` — sección Gestión

Sub-pestañas **Casas** y **Trabajadores**, con contadores.

**Casas**
- Formulario de alta/edición con todos los campos.
- Búsqueda por texto.
- Filtro de solo pendientes.
- Listado con estado activo/inactivo, datos pendientes y acciones editar/activar/eliminar.
- Eliminación con confirmación; si la API responde `409`, se ofrece desactivar.

**Trabajadores**
- Formulario de alta/edición: nombre, apellidos, código, contacto, dirección, población.
- **Perfil del trabajador** al pulsar su nombre o el botón “Perfil”: modal con periodos **Día / Semana / Mes**, horas totales del periodo, servicios, casas distintas, casas realizadas y detalle de cada servicio.
- Resumen de **horas trabajadas** por fecha, con el total del día y navegación día anterior/siguiente/Hoy.
- Búsqueda.
- Listado con estado activo/inactivo y datos pendientes.
- Activación/desactivación sin borrar historial.

En ambas, el formulario aparece **encima** del listado.

### `HorariosView` — sección Historial

- Lista de días guardados con fecha, archivo, estado y número de servicios.
- Selección de un día para ver su detalle y los trabajadores de cada servicio.

### Vistas heredadas

- `TrabajadoresView.jsx`: resumen diario y perfil por mes. Conserva dos avisos de ESLint (`exhaustive-deps`). No está en la navegación principal.
- `FacturasView.jsx` / `FacturaDetalleView.jsx`: módulo de facturación aplazado. `FacturaDetalleView.jsx` también conserva un aviso de ESLint.

---

## Estado y flujo de datos

Todo el estado principal vive en `HorariosView`:

| Grupo | Estado |
| --- | --- |
| Análisis | `imagen`, `cargando`, `resultado`, `error`, `pestanaHorario`, `editandoIndex`, `fecha`, `guardando` |
| Catálogos | `casas`, `trabajadores`, `cargandoDatos` |
| Gestión | `pestanaGestion`, `nuevaCasa`, `nuevoTrabajador`, `casaEditando`, `trabajadorEditando`, `busquedaCasa`, `busquedaTrabajador`, `soloPendientes` |
| Historial | `historial`, `diaHistorial`, `serviciosHistorial`, `cargandoHistorial` |

Flujo típico:

1. Al montar, se cargan casas y trabajadores (`GET /casas`, `GET /trabajadores`).
2. El usuario elige una imagen y pulsa analizar.
3. `POST /horarios/analizar` devuelve servicios validados.
4. El usuario corrige en la tabla y pulsa guardar.
5. `POST /horarios/guardar-completo` persiste el día.
6. El historial se recarga al entrar en la sección.

---

## Consumo de la API

Todas las llamadas usan `fetch` contra `API_BASE`.

| Acción | Endpoint |
| --- | --- |
| Cargar catálogos | `GET /casas`, `GET /trabajadores` |
| Analizar imagen | `POST /horarios/analizar` (multipart) |
| Guardar día | `POST /horarios/guardar-completo` |
| Historial | `GET /horarios/historial`, `GET /horarios/historial/:id` |
| Casas | `POST/PUT/PATCH/DELETE /casas` |
| Trabajadores | `POST/PUT/PATCH /trabajadores` |
| Resumen/perfil | `GET /trabajadores/resumen-diario`, `GET /trabajadores/:id/perfil` |
| Facturación | `/casas/resumen-facturacion`, `/casas/:id/visitas`, `/facturas/*` |

La interfaz normaliza `activo` y `datos_pendientes` porque MySQL los devuelve como `tinyint` (`1`/`0`).

---

## Estilos y diseño

- CSS plano en `App.css` e `index.css`.
- Cabecera blanca con borde inferior y acento azul.
- Marca **Claudia Netella** + etiqueta **Gestor de Horarios**.
- Navegación con pestañas; la activa en azul y las inactivas en gris.
- Layout responsive: en pantallas estrechas la cabecera se apila y las pestañas pasan a una cuadrícula de tres columnas.
- Tablas con versión responsive y formularios en tarjetas.
- Paleta basada en grises (`#111827`, `#6b7280`, `#e5e7eb`) y azul (`#2563eb`).

---

## Scripts

| Comando | Descripción |
| --- | --- |
| `npm run dev` | Servidor de desarrollo con HMR. |
| `npm run build` | Build de producción en `dist/`. |
| `npm run preview` | Sirve el build. |
| `npm run lint` | ESLint sobre todo el proyecto. |

Verificación recomendada antes de commitear:

```bash
npm run lint
npm run build
```

---

## Calidad

- `npm run lint`: **0 errores**. Quedan 2 avisos preexistentes de `react-hooks/exhaustive-deps` en `FacturaDetalleView.jsx` y `TrabajadoresView.jsx`.
- `npm run build`: correcto.
- Sin tests automatizados.

---

## Limitaciones

- URL de la API hardcodeada; no hay `.env` ni proxy.
- Sin autenticación ni manejo de sesión.
- Estado centralizado en un único archivo grande (`App.jsx`), lo que complica el mantenimiento a medida que crece.
- Vistas de facturación presentes pero aplazadas y fuera de la navegación.
- Sin internacionalización: textos en español fijados en el código.
- Sin paginación en listados largos (se filtra en cliente).
- Sin tests de componentes ni end-to-end.
