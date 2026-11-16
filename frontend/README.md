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
│   ├── FacturaDetalleView.jsx
│   └── BackupView.jsx       # Copias de seguridad y exportaciones
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
| `/historial` | `HorariosView` | Historial de días guardados y edición. |
| `/copias` | `BackupView` | Copias de seguridad, exportaciones y Google Drive. |
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
- Las pestañas **Horarios**, **Gestión**, **Historial** y **Copias de seguridad**.

Las tres primeras rutas renderizan el mismo componente `HorariosView`, que decide qué sección mostrar según `location.pathname`. Así el estado del análisis no se pierde al cambiar de pestaña. `BackupView` es independiente y se encarga de las exportaciones y las copias.

---

## Vistas y componentes

### `HorariosView` — sección Horarios

- Pestañas **Analizar** y **Revisar**.
- Selector de imagen con vista previa.
- Botón de análisis con estado de carga y mensajes de error.
- Tabla editable de servicios: fecha, casa, hora de inicio, hora de fin y trabajadores.
- Botón **Eliminar** en cada servicio, tanto en la vista normal como durante la edición.
- Fila manual permanente al final de la tabla: permite seleccionar una casa existente o escribir una nueva, indicar horas y trabajadores y pulsar **Añadir servicio**; se comporta igual que una fila detectada y se puede repetir para varias casas.
- Botón **Añadir casa** para casas no registradas: crea la casa con su nombre y la vincula al servicio sin salir de la revisión.
- Botón **Escribir nombre** para dar de alta una casa manualmente (por ejemplo si la IA no la reconoce o la confunde); admite corregir el nombre y reutiliza la casa si ya existe.
- Botón **Cargar otra imagen** junto a **Guardar horario** para descartar la revisión y volver a subir una foto.
- Marca visualmente casas o trabajadores no encontrados y datos pendientes.
- Botón de guardado con feedback de éxito/error; si la fila manual tiene datos completos se guarda junto al resto aunque no se haya pulsado **Añadir servicio**.

### `HorariosView` — sección Gestión

Sub-pestañas **Casas** y **Trabajadores**, con contadores.

**Casas**
- Formulario de alta/edición con todos los campos.
- Búsqueda por texto.
- Filtro de solo pendientes.
- Listado con estado activo/inactivo, datos pendientes y acciones perfil/editar/activar/eliminar.
- **Perfil de la casa** al pulsar su nombre o el botón “Perfil”: modal con periodos **Día / Semana / Mes**, horas reales del periodo, servicios, trabajadores distintos, total histórico y detalle de cada servicio con sus trabajadores. Las horas salen de `hora_inicio`/`hora_fin`, no de la duración de referencia.
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
- Botón **Editar** por día y **Editar día** en el detalle: abre un editor en tabla con fecha del día, fecha por servicio, casa, hora de inicio, hora de fin, duración en horas decimales, trabajadores, observaciones y acciones para añadir o eliminar servicios y trabajadores.
- Al cambiar la hora de inicio se conserva la duración y se recalcula el fin; al cambiar la duración se recalcula el fin. Los totales de horas de servicio y horas individuales se muestran en vivo.
- Al cambiar la fecha del día se mueven los servicios que seguían usando esa fecha; los que tienen fecha propia se respetan.
- Botón **Guardar cambios** con validación (casa, horas, fecha y al menos un trabajador por servicio) y feedback de éxito/error. El guardado conserva los IDs y no duplica registros.
- Botón **Eliminar** por día con confirmación que indica la fecha y el número de servicios; borra el día, sus servicios y asignaciones (nunca casas ni trabajadores) y refresca los totales.

### `BackupView` — Copias de seguridad

- Cinco exportaciones: clientes y casas, trabajadores, historial de servicios, SQL y **copia completa ZIP**.
- Descarga con progreso real mediante `XMLHttpRequest` y bloqueo de botones mientras hay una exportación en curso para evitar duplicados.
- Resultado de la verificación del servidor (cabecera `X-Verificacion`) con comprobaciones y errores.
- Historial de copias con nombre, fecha, tipo, tamaño, estado, verificación y acciones: descargar, verificar, probar restauración en base temporal, restaurar y subir a Drive.
- Formulario de copias automáticas: activación, frecuencia diaria/semanal, hora, día de la semana, retención y carpeta de destino adicional. Incluye **Ejecutar ahora**.
- Estado de Google Drive: conectar/desconectar y subir copias cuando hay credenciales configuradas.
- Modal de restauración con aviso de sobrescritura y confirmación escribiendo `RESTAURAR`; el botón permanece deshabilitado hasta que el texto coincide.

### Vistas heredadas

- `TrabajadoresView.jsx`: resumen diario y perfil por mes. Conserva dos avisos de ESLint (`exhaustive-deps`). No está en la navegación principal.
- `FacturasView.jsx` / `FacturaDetalleView.jsx`: módulo de facturación aplazado. `FacturaDetalleView.jsx` también conserva un aviso de ESLint.

---

## Estado y flujo de datos

Todo el estado principal vive en `HorariosView`:

| Grupo | Estado |
| --- | --- |
| Análisis | `imagen`, `cargando`, `resultado`, `error`, `pestanaHorario`, `editandoIndex`, `fecha`, `guardando`, `servicioManual` |
| Catálogos | `casas`, `trabajadores`, `cargandoDatos` |
| Gestión | `pestanaGestion`, `nuevaCasa`, `nuevoTrabajador`, `casaEditando`, `trabajadorEditando`, `busquedaCasa`, `busquedaTrabajador`, `soloPendientes` |
| Perfiles | `trabajadorPerfil`, `periodoPerfil`, `fechaPerfil`, `mesPerfil`, `perfilTrabajador`; `casaPerfil`, `periodoPerfilCasa`, `fechaPerfilCasa`, `mesPerfilCasa`, `perfilCasa` |
| Historial | `historial`, `diaHistorial`, `serviciosHistorial`, `cargandoHistorial`, `eliminandoDiaId`; edición: `editandoDiaHistorial`, `fechaEdicionHistorial`, `serviciosEdicionHistorial`, `guardandoDiaHistorial`, `errorEdicionHistorial`, `mensajeEdicionHistorial` |

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
| Historial | `GET /horarios/historial`, `GET /horarios/historial/:id`, `PUT /horarios/historial/:id`, `DELETE /horarios/historial/:id` |
| Copias | `GET /backups`, `GET/PUT /backups/configuracion`, `POST /backups/exportar/*`, `GET /backups/:nombre/descargar`, `POST /backups/:nombre/verificar`, `POST /backups/:nombre/probar-restauracion`, `POST /backups/restaurar`, `POST /backups/automatico/ejecutar` |
| Google Drive | `GET /backups/google-drive/estado`, `GET /backups/google-drive/autorizar`, `POST /backups/google-drive/subir`, `POST /backups/google-drive/desconectar` |
| Casas | `POST/PUT/PATCH/DELETE /casas`, `GET /casas/:id/perfil` |
| Trabajadores | `POST/PUT/PATCH /trabajadores` |
| Resumen/perfil | `GET /trabajadores/resumen-diario`, `GET /trabajadores/:id/perfil`, `GET /casas/:id/perfil` |
| Facturación | `/casas/resumen-facturacion`, `/casas/:id/visitas`, `/facturas/*` |

La interfaz normaliza `activo` y `datos_pendientes` porque MySQL los devuelve como `tinyint` (`1`/`0`).

---

## Estilos y diseño

- CSS plano en `App.css` e `index.css`.
- Cabecera blanca con borde inferior y acento azul.
- Marca **Claudia Netella** + etiqueta **Gestor de Horarios**.
- Navegación con pestañas; la activa en azul y las inactivas en gris.
- Layout responsive: en pantallas estrechas la cabecera se apila y las pestañas pasan a una cuadrícula de dos columnas.
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
- La conexión con Google Drive depende de que el backend tenga `GOOGLE_DRIVE_CLIENT_ID` y `GOOGLE_DRIVE_CLIENT_SECRET`; el frontend nunca maneja tokens.
- Las exportaciones y restauraciones requieren el backend y los clientes `mysqldump`/`mysql` disponibles en el servidor.
