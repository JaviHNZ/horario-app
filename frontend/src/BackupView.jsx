import { useEffect, useState } from "react";

const API_BASE = "http://localhost:3000/api";

const formatearBytes = (bytes) => {
  const total = Number(bytes);

  if (!Number.isFinite(total) || total <= 0) {
    return "0 B";
  }

  const unidades = ["B", "KB", "MB", "GB"];
  const indice = Math.min(
    unidades.length - 1,
    Math.floor(Math.log(total) / Math.log(1024)),
  );

  return `${(total / 1024 ** indice).toFixed(indice === 0 ? 0 : 1)} ${
    unidades[indice]
  }`;
};

const formatearFechaHora = (valor) => {
  if (!valor) {
    return "-";
  }

  const fecha = new Date(valor);

  if (Number.isNaN(fecha.getTime())) {
    return String(valor);
  }

  return fecha.toLocaleString("es-ES");
};

const ETIQUETAS_TIPO = {
  completa: "Completa (ZIP)",
  automatica: "Automática",
  sql: "Base de datos SQL",
  "pre-restauracion": "Previa a restauración",
};

const DIAS_SEMANA = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
];

// Descarga un archivo con progreso real mediante XHR (fetch no informa del
// progreso de descarga de forma fiable en todos los navegadores).
const descargarConProgreso = ({ url, metodo = "POST", nombreSugerido }) =>
  new Promise((resolve, reject) => {
    const peticion = new XMLHttpRequest();

    peticion.open(metodo, url);
    peticion.responseType = "blob";

    peticion.onload = () => {
      if (peticion.status < 200 || peticion.status >= 300) {
        const lector = new FileReader();

        lector.onload = () => {
          let mensaje = `Error ${peticion.status} al generar el archivo`;

          try {
            const datos = JSON.parse(lector.result);
            mensaje = datos.error || mensaje;
          } catch {
            // La respuesta de error no es JSON.
          }

          reject(new Error(mensaje));
        };

        lector.onerror = () =>
          reject(new Error(`Error ${peticion.status} al generar el archivo`));
        lector.readAsText(peticion.response);

        return;
      }

      const cabeceraVerificacion = peticion.getResponseHeader("X-Verificacion");
      let verificacion = null;

      if (cabeceraVerificacion) {
        try {
          verificacion = JSON.parse(decodeURIComponent(cabeceraVerificacion));
        } catch {
          verificacion = null;
        }
      }

      const disposicion =
        peticion.getResponseHeader("Content-Disposition") || "";
      const coincidencia = /filename="?([^";]+)"?/i.exec(disposicion);
      const nombre = nombreSugerido || coincidencia?.[1] || "descarga";

      const blob = peticion.response;
      const enlace = document.createElement("a");
      const urlBlob = URL.createObjectURL(blob);

      enlace.href = urlBlob;
      enlace.download = nombre;
      document.body.appendChild(enlace);
      enlace.click();
      enlace.remove();
      URL.revokeObjectURL(urlBlob);

      resolve({ verificacion, nombre, tamano: blob.size });
    };

    peticion.onerror = () =>
      reject(new Error("Error de red al generar el archivo"));
    peticion.onabort = () => reject(new Error("Descarga cancelada"));

    peticion.send();
  });

function BackupView() {
  const [copias, setCopias] = useState([]);
  const [cargandoCopias, setCargandoCopias] = useState(true);
  const [error, setError] = useState(() => {
    const parametros = new URLSearchParams(window.location.search);

    return parametros.get("drive") === "error"
      ? parametros.get("mensaje") || "No se pudo conectar con Google Drive."
      : "";
  });
  const [mensaje, setMensaje] = useState(() => {
    const parametros = new URLSearchParams(window.location.search);

    return parametros.get("drive") === "ok"
      ? "Google Drive conectado correctamente."
      : "";
  });

  const [exportando, setExportando] = useState(null);
  const [progreso, setProgreso] = useState(0);
  const [ultimaVerificacion, setUltimaVerificacion] = useState(null);

  const [verificando, setVerificando] = useState(null);
  const [resultadoVerificacion, setResultadoVerificacion] = useState(null);

  const [probandoRestauracion, setProbandoRestauracion] = useState(null);
  const [resultadoRestauracion, setResultadoRestauracion] = useState(null);

  const [copiaARestaurar, setCopiaARestaurar] = useState(null);
  const [confirmacionRestaurar, setConfirmacionRestaurar] = useState("");
  const [restaurando, setRestaurando] = useState(false);

  const [subiendoDrive, setSubiendoDrive] = useState(null);

  const [configuracion, setConfiguracion] = useState({
    activo: false,
    frecuencia: "diaria",
    hora: "02:00",
    diaSemana: 1,
    retencion: 0,
    carpetaDestino: "",
  });
  const [ultimaEjecucion, setUltimaEjecucion] = useState(null);
  const [guardandoConfiguracion, setGuardandoConfiguracion] = useState(false);

  const [estadoDrive, setEstadoDrive] = useState(null);
  const [cargandoDrive, setCargandoDrive] = useState(true);

  const cargarCopias = async () => {
    try {
      setCargandoCopias(true);

      const respuesta = await fetch(`${API_BASE}/backups`);
      const datos = await respuesta.json();

      if (!respuesta.ok || !datos.ok) {
        throw new Error(datos.error || "Error cargando las copias");
      }

      setCopias(datos.copias || []);
    } catch (errorCarga) {
      console.error(errorCarga);
      setError(errorCarga.message);
    } finally {
      setCargandoCopias(false);
    }
  };

  const cargarConfiguracion = async () => {
    try {
      const respuesta = await fetch(`${API_BASE}/backups/configuracion`);
      const datos = await respuesta.json();

      if (!respuesta.ok || !datos.ok) {
        throw new Error(
          datos.error || "Error cargando la configuración de copias",
        );
      }

      setConfiguracion(datos.configuracion.automatico);
      setUltimaEjecucion(datos.configuracion.ultimaEjecucion);
    } catch (errorCarga) {
      console.error(errorCarga);
      setError(errorCarga.message);
    }
  };

  const cargarEstadoDrive = async () => {
    try {
      setCargandoDrive(true);

      const respuesta = await fetch(
        `${API_BASE}/backups/google-drive/estado`,
      );
      const datos = await respuesta.json();

      if (!respuesta.ok || !datos.ok) {
        throw new Error(datos.error || "Error consultando Google Drive");
      }

      setEstadoDrive(datos.estado);
    } catch (errorCarga) {
      console.error(errorCarga);
      setError(errorCarga.message);
    } finally {
      setCargandoDrive(false);
    }
  };

  useEffect(() => {
    Promise.resolve().then(() => {
      cargarCopias();
      cargarConfiguracion();
      cargarEstadoDrive();
    });
  }, []);

  const ejecutarExportacion = async (clave, url, nombreSugerido) => {
    if (exportando) {
      return;
    }

    setExportando(clave);
    setProgreso(0);
    setError("");
    setMensaje("");
    setUltimaVerificacion(null);

    try {
      const resultado = await descargarConProgreso({
        url: `${API_BASE}${url}`,
        nombreSugerido,
      });

      setProgreso(100);
      setUltimaVerificacion({
        archivo: resultado.nombre,
        tamano: resultado.tamano,
        ...(resultado.verificacion || {}),
      });

      if (resultado.verificacion && resultado.verificacion.ok === false) {
        setError(
          "El archivo se ha generado, pero la verificación ha detectado errores.",
        );
      } else {
        setMensaje(`Archivo generado y verificado: ${resultado.nombre}`);
      }

      if (clave === "sql" || clave === "completo") {
        await cargarCopias();
      }
    } catch (errorExportacion) {
      console.error(errorExportacion);
      setError(errorExportacion.message);
    } finally {
      setExportando(null);
    }
  };

  const descargarCopia = (copia) => {
    const enlace = document.createElement("a");
    enlace.href = `${API_BASE}/backups/${encodeURIComponent(
      copia.nombre,
    )}/descargar`;
    enlace.download = copia.nombre;
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
  };

  const verificarCopia = async (copia) => {
    if (verificando) {
      return;
    }

    setVerificando(copia.nombre);
    setError("");
    setMensaje("");
    setResultadoVerificacion(null);

    try {
      const respuesta = await fetch(
        `${API_BASE}/backups/${encodeURIComponent(copia.nombre)}/verificar`,
        { method: "POST" },
      );
      const datos = await respuesta.json();

      if (!respuesta.ok || !datos.ok) {
        throw new Error(datos.error || "Error verificando la copia");
      }

      setResultadoVerificacion(datos.verificacion);
    } catch (errorVerificacion) {
      console.error(errorVerificacion);
      setError(errorVerificacion.message);
    } finally {
      setVerificando(null);
    }
  };

  const probarRestauracion = async (copia) => {
    if (probandoRestauracion) {
      return;
    }

    setProbandoRestauracion(copia.nombre);
    setError("");
    setMensaje("");
    setResultadoRestauracion(null);

    try {
      const respuesta = await fetch(
        `${API_BASE}/backups/${encodeURIComponent(
          copia.nombre,
        )}/probar-restauracion`,
        { method: "POST" },
      );
      const datos = await respuesta.json();

      if (!respuesta.ok || !datos.ok) {
        throw new Error(datos.error || "Error en la restauración de prueba");
      }

      setResultadoRestauracion(datos.verificacion);
      setMensaje(
        "Restauración de prueba completada en una base de datos aislada.",
      );
    } catch (errorPrueba) {
      console.error(errorPrueba);
      setError(errorPrueba.message);
    } finally {
      setProbandoRestauracion(null);
    }
  };

  const abrirRestauracion = (copia) => {
    setCopiaARestaurar(copia);
    setConfirmacionRestaurar("");
  };

  const cerrarRestauracion = () => {
    if (restaurando) {
      return;
    }

    setCopiaARestaurar(null);
    setConfirmacionRestaurar("");
  };

  const restaurarCopia = async () => {
    if (!copiaARestaurar || restaurando) {
      return;
    }

    setRestaurando(true);
    setError("");
    setMensaje("");

    try {
      const respuesta = await fetch(`${API_BASE}/backups/restaurar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: copiaARestaurar.nombre,
          confirmacion: confirmacionRestaurar,
        }),
      });
      const datos = await respuesta.json();

      if (!respuesta.ok || !datos.ok) {
        throw new Error(datos.error || "Error restaurando la copia");
      }

      setMensaje(datos.mensaje || "Base de datos restaurada correctamente.");
      setCopiaARestaurar(null);
      setConfirmacionRestaurar("");
      await cargarCopias();
    } catch (errorRestauracion) {
      console.error(errorRestauracion);
      setError(errorRestauracion.message);
    } finally {
      setRestaurando(false);
    }
  };

  const guardarConfiguracion = async (event) => {
    event.preventDefault();

    if (guardandoConfiguracion) {
      return;
    }

    setGuardandoConfiguracion(true);
    setError("");
    setMensaje("");

    try {
      const respuesta = await fetch(`${API_BASE}/backups/configuracion`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          automatico: {
            ...configuracion,
            activo: Boolean(configuracion.activo),
            retencion: Number(configuracion.retencion) || 0,
            diaSemana: Number(configuracion.diaSemana),
          },
        }),
      });
      const datos = await respuesta.json();

      if (!respuesta.ok || !datos.ok) {
        throw new Error(datos.error || "Error guardando la configuración");
      }

      setConfiguracion(datos.configuracion.automatico);
      setUltimaEjecucion(datos.configuracion.ultimaEjecucion);
      setMensaje("Configuración de copias automáticas guardada.");
    } catch (errorConfiguracion) {
      console.error(errorConfiguracion);
      setError(errorConfiguracion.message);
    } finally {
      setGuardandoConfiguracion(false);
    }
  };

  const ejecutarAutomaticaAhora = async () => {
    if (exportando) {
      return;
    }

    setExportando("automatica");
    setError("");
    setMensaje("");

    try {
      const respuesta = await fetch(
        `${API_BASE}/backups/automatico/ejecutar`,
        { method: "POST" },
      );
      const datos = await respuesta.json();

      if (!respuesta.ok || !datos.ok) {
        throw new Error(datos.error || "Error ejecutando la copia automática");
      }

      setMensaje(`Copia automática creada: ${datos.copia.nombre}`);
      await cargarCopias();
      await cargarConfiguracion();
    } catch (errorAutomatica) {
      console.error(errorAutomatica);
      setError(errorAutomatica.message);
    } finally {
      setExportando(null);
    }
  };

  const conectarDrive = async () => {
    setError("");
    setMensaje("");

    try {
      const respuesta = await fetch(
        `${API_BASE}/backups/google-drive/autorizar`,
      );
      const datos = await respuesta.json();

      if (!respuesta.ok || !datos.ok) {
        throw new Error(datos.error || "Error iniciando Google Drive");
      }

      window.location.href = datos.url;
    } catch (errorDrive) {
      console.error(errorDrive);
      setError(errorDrive.message);
    }
  };

  const desconectarDrive = async () => {
    setError("");
    setMensaje("");

    try {
      const respuesta = await fetch(
        `${API_BASE}/backups/google-drive/desconectar`,
        { method: "POST" },
      );
      const datos = await respuesta.json();

      if (!respuesta.ok || !datos.ok) {
        throw new Error(datos.error || "Error desconectando Google Drive");
      }

      setMensaje("Google Drive desconectado.");
      await cargarEstadoDrive();
    } catch (errorDrive) {
      console.error(errorDrive);
      setError(errorDrive.message);
    }
  };

  const subirDrive = async (copia) => {
    if (subiendoDrive) {
      return;
    }

    setSubiendoDrive(copia.nombre);
    setError("");
    setMensaje("");

    try {
      const respuesta = await fetch(
        `${API_BASE}/backups/google-drive/subir`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nombre: copia.nombre }),
        },
      );
      const datos = await respuesta.json();

      if (!respuesta.ok || !datos.ok) {
        throw new Error(datos.error || "Error subiendo a Google Drive");
      }

      setMensaje(
        datos.duplicado
          ? "Ese archivo ya estaba en Google Drive; no se ha duplicado."
          : `Copia subida a Google Drive en ${datos.carpeta}.`,
      );
      await cargarCopias();
    } catch (errorDrive) {
      console.error(errorDrive);
      setError(errorDrive.message);
    } finally {
      setSubiendoDrive(null);
    }
  };

  const ocupado = Boolean(exportando);

  return (
    <section className="card copias">
      <div className="gestion-header">
        <div>
          <h2>Copias de seguridad</h2>

          <p>
            Exporta clientes, trabajadores y servicios, descarga una copia
            técnica de MySQL y programa copias automáticas.
          </p>
        </div>
      </div>

      {mensaje && (
        <div className="mensaje-exito" role="status">
          {mensaje}
        </div>
      )}

      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      {/* ================================= */}
      {/* EXPORTACIONES */}
      {/* ================================= */}

      <div className="copias-bloque">
        <h3>Exportaciones</h3>

        <div className="copias-grid">
          <div className="copia-opcion">
            <div>
              <strong>1. Clientes y casas</strong>
              <p>Excel con clientes, actividad y resumen mensual.</p>
            </div>
            <button
              type="button"
              className="btn-primary"
              disabled={ocupado}
              onClick={() =>
                ejecutarExportacion(
                  "clientes",
                  "/backups/exportar/clientes-casas",
                  "clientes_casas.xlsx",
                )
              }
            >
              {exportando === "clientes" ? "Generando..." : "Exportar"}
            </button>
          </div>

          <div className="copia-opcion">
            <div>
              <strong>2. Trabajadores</strong>
              <p>Excel con datos, historial de trabajo y resumen de horas.</p>
            </div>
            <button
              type="button"
              className="btn-primary"
              disabled={ocupado}
              onClick={() =>
                ejecutarExportacion(
                  "trabajadores",
                  "/backups/exportar/trabajadores",
                  "trabajadores.xlsx",
                )
              }
            >
              {exportando === "trabajadores" ? "Generando..." : "Exportar"}
            </button>
          </div>

          <div className="copia-opcion">
            <div>
              <strong>3. Historial de servicios</strong>
              <p>
                Excel con todos los servicios y sus resúmenes por mes, casa y
                trabajador.
              </p>
            </div>
            <button
              type="button"
              className="btn-primary"
              disabled={ocupado}
              onClick={() =>
                ejecutarExportacion(
                  "servicios",
                  "/backups/exportar/servicios",
                  "servicios_historial.xlsx",
                )
              }
            >
              {exportando === "servicios" ? "Generando..." : "Exportar"}
            </button>
          </div>

          <div className="copia-opcion">
            <div>
              <strong>4. Base de datos SQL</strong>
              <p>
                Copia real con estructura y datos de MySQL, sin contraseñas ni
                claves.
              </p>
            </div>
            <button
              type="button"
              className="btn-primary"
              disabled={ocupado}
              onClick={() =>
                ejecutarExportacion(
                  "sql",
                  "/backups/exportar/sql",
                  "base_datos_completa.sql",
                )
              }
            >
              {exportando === "sql" ? "Generando..." : "Descargar SQL"}
            </button>
          </div>

          <div className="copia-opcion copia-opcion-destacada">
            <div>
              <strong>5. Copia completa (ZIP)</strong>
              <p>
                Los tres Excel, el SQL y un README con instrucciones de
                restauración.
              </p>
            </div>
            <button
              type="button"
              className="btn-primary"
              disabled={ocupado}
              onClick={() =>
                ejecutarExportacion(
                  "completo",
                  "/backups/exportar/completo",
                )
              }
            >
              {exportando === "completo"
                ? "Generando copia..."
                : "Exportar copia completa"}
            </button>
          </div>
        </div>

        {exportando && (
          <div className="copia-progreso" role="status">
            <div className="copia-progreso-barra">
              <div
                className="copia-progreso-relleno"
                style={{ width: `${progreso}%` }}
              />
            </div>

            <span>{progreso}%</span>
          </div>
        )}

        {ultimaVerificacion && (
          <div
            className={`copia-verificacion ${
              ultimaVerificacion.ok === false
                ? "copia-verificacion-error"
                : "copia-verificacion-ok"
            }`}
          >
            <strong>
              {ultimaVerificacion.ok === false
                ? "Verificación con errores"
                : "Verificación correcta"}
            </strong>

            <span>
              {ultimaVerificacion.archivo} ·{" "}
              {formatearBytes(ultimaVerificacion.tamano)} ·{" "}
              {ultimaVerificacion.comprobaciones ?? 0} comprobaciones
            </span>

            {ultimaVerificacion.errores?.length > 0 && (
              <ul>
                {ultimaVerificacion.errores.map((detalle, indice) => (
                  <li key={indice}>{detalle}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* ================================= */}
      {/* HISTORIAL DE COPIAS */}
      {/* ================================= */}

      <div className="copias-bloque">
        <div className="copias-bloque-cabecera">
          <h3>Historial de copias</h3>

          <button
            type="button"
            className="btn-secondary"
            onClick={cargarCopias}
            disabled={cargandoCopias}
          >
            {cargandoCopias ? "Actualizando..." : "Actualizar"}
          </button>
        </div>

        {cargandoCopias && copias.length === 0 ? (
          <p className="gestion-vacio">Cargando copias...</p>
        ) : copias.length === 0 ? (
          <p className="gestion-vacio">
            Todavía no hay copias guardadas. Genera una copia completa o un
            respaldo SQL.
          </p>
        ) : (
          <div className="tabla-responsive">
            <table className="tabla-datos tabla-copias">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Fecha y hora</th>
                  <th>Tipo</th>
                  <th>Tamaño</th>
                  <th>Estado</th>
                  <th>Verificación</th>
                  <th>Acciones</th>
                </tr>
              </thead>

              <tbody>
                {copias.map((copia) => (
                  <tr key={copia.id || copia.nombre}>
                    <td className="celda-nombre-copia">{copia.nombre}</td>
                    <td>{formatearFechaHora(copia.fecha)}</td>
                    <td>{ETIQUETAS_TIPO[copia.tipo] || copia.tipo}</td>
                    <td>{formatearBytes(copia.tamano)}</td>
                    <td>
                      <span
                        className={`copia-estado copia-estado-${copia.estado}`}
                      >
                        {copia.estado === "completada"
                          ? "Completada"
                          : copia.estado === "con_errores"
                            ? "Con errores"
                            : copia.estado}
                      </span>
                    </td>
                    <td>
                      {copia.verificacion?.ok ? "Correcta" : "Con errores"}
                    </td>
                    <td>
                      <div className="copia-acciones">
                        <button
                          type="button"
                          className="btn-editar"
                          onClick={() => descargarCopia(copia)}
                          disabled={!copia.disponible}
                          title={
                            copia.disponible
                              ? "Descargar esta copia"
                              : "El archivo ya no está almacenado"
                          }
                        >
                          Descargar
                        </button>

                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => verificarCopia(copia)}
                          disabled={Boolean(verificando)}
                        >
                          {verificando === copia.nombre
                            ? "Verificando..."
                            : "Verificar"}
                        </button>

                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => probarRestauracion(copia)}
                          disabled={Boolean(probandoRestauracion)}
                        >
                          {probandoRestauracion === copia.nombre
                            ? "Probando..."
                            : "Probar restauración"}
                        </button>

                        <button
                          type="button"
                          className="btn-eliminar-dia"
                          onClick={() => abrirRestauracion(copia)}
                        >
                          Restaurar
                        </button>

                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => subirDrive(copia)}
                          disabled={
                            !estadoDrive?.conectado || Boolean(subiendoDrive)
                          }
                          title={
                            estadoDrive?.conectado
                              ? "Subir a Google Drive"
                              : "Conecta Google Drive primero"
                          }
                        >
                          {subiendoDrive === copia.nombre
                            ? "Subiendo..."
                            : "Subir a Drive"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {resultadoVerificacion && (
          <div className="copia-verificacion copia-verificacion-detalle">
            <strong>
              Verificación de {resultadoVerificacion.nombre}:{" "}
              {resultadoVerificacion.ok ? "correcta" : "con errores"}
            </strong>

            <ul>
              {resultadoVerificacion.comprobaciones.map(
                (comprobacion, indice) => (
                  <li key={indice}>
                    {comprobacion.ok ? "✓" : "✗"} {comprobacion.nombre} —{" "}
                    {comprobacion.detalle}
                  </li>
                ),
              )}
            </ul>
          </div>
        )}

        {resultadoRestauracion && (
          <div className="copia-verificacion copia-verificacion-detalle">
            <strong>
              Restauración de prueba en{" "}
              {resultadoRestauracion.base_temporal}:{" "}
              {resultadoRestauracion.ok ? "correcta" : "con errores"}
            </strong>

            <ul>
              {resultadoRestauracion.comprobaciones.map(
                (comprobacion, indice) => (
                  <li key={indice}>
                    {comprobacion.ok ? "✓" : "✗"} {comprobacion.nombre} —{" "}
                    {comprobacion.detalle}
                  </li>
                ),
              )}
            </ul>
          </div>
        )}
      </div>

      {/* ================================= */}
      {/* COPIAS AUTOMÁTICAS */}
      {/* ================================= */}

      <div className="copias-bloque">
        <h3>Copias automáticas</h3>

        <p className="copias-ayuda">
          Las copias se ejecutan en el servidor (backend) y no dependen de que
          el navegador esté abierto. La retención solo se aplica a las copias
          automáticas; 0 significa conservarlas todas.
        </p>

        <form className="copias-form" onSubmit={guardarConfiguracion}>
          <label className="copia-campo copia-campo-check">
            <input
              type="checkbox"
              checked={Boolean(configuracion.activo)}
              onChange={(event) =>
                setConfiguracion((actual) => ({
                  ...actual,
                  activo: event.target.checked,
                }))
              }
            />
            Activar copias automáticas
          </label>

          <label className="copia-campo">
            Frecuencia
            <select
              value={configuracion.frecuencia}
              onChange={(event) =>
                setConfiguracion((actual) => ({
                  ...actual,
                  frecuencia: event.target.value,
                }))
              }
            >
              <option value="diaria">Diaria</option>
              <option value="semanal">Semanal</option>
            </select>
          </label>

          <label className="copia-campo">
            Hora
            <input
              type="time"
              value={configuracion.hora}
              onChange={(event) =>
                setConfiguracion((actual) => ({
                  ...actual,
                  hora: event.target.value,
                }))
              }
            />
          </label>

          {configuracion.frecuencia === "semanal" && (
            <label className="copia-campo">
              Día de la semana
              <select
                value={configuracion.diaSemana}
                onChange={(event) =>
                  setConfiguracion((actual) => ({
                    ...actual,
                    diaSemana: Number(event.target.value),
                  }))
                }
              >
                {DIAS_SEMANA.map((dia, indice) => (
                  <option key={dia} value={indice}>
                    {dia}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="copia-campo">
            Retención (nº de copias)
            <input
              type="number"
              min="0"
              step="1"
              value={configuracion.retencion}
              onChange={(event) =>
                setConfiguracion((actual) => ({
                  ...actual,
                  retencion: event.target.value,
                }))
              }
            />
          </label>

          <label className="copia-campo copia-campo-ancho">
            Carpeta de destino adicional (opcional)
            <input
              type="text"
              placeholder="/ruta/del/servidor/copias"
              value={configuracion.carpetaDestino}
              onChange={(event) =>
                setConfiguracion((actual) => ({
                  ...actual,
                  carpetaDestino: event.target.value,
                }))
              }
            />
          </label>

          <div className="copias-form-acciones">
            <button
              type="submit"
              className="btn-primary"
              disabled={guardandoConfiguracion}
            >
              {guardandoConfiguracion
                ? "Guardando..."
                : "Guardar configuración"}
            </button>

            <button
              type="button"
              className="btn-secondary"
              onClick={ejecutarAutomaticaAhora}
              disabled={ocupado}
            >
              Ejecutar ahora
            </button>
          </div>
        </form>

        <p className="copias-ayuda">
          Última ejecución automática: {formatearFechaHora(ultimaEjecucion)}
        </p>

        <p className="copias-ayuda">
          Si prefieres usar cron o systemd, ejecuta{" "}
          <code>node scripts/backup-automatico.js</code> desde la carpeta del
          backend. Respeta esta misma configuración.
        </p>
      </div>

      {/* ================================= */}
      {/* GOOGLE DRIVE */}
      {/* ================================= */}

      <div className="copias-bloque">
        <h3>Google Drive</h3>

        {cargandoDrive ? (
          <p className="gestion-vacio">Consultando Google Drive...</p>
        ) : estadoDrive?.configurado ? (
          <>
            <p className="copias-ayuda">
              Estado:{" "}
              <strong>
                {estadoDrive.conectado ? "Conectado" : "Sin conectar"}
              </strong>
              . Las copias se suben a la carpeta «Claudia Neteja», organizadas
              por fecha.
            </p>

            <div className="copias-form-acciones">
              {estadoDrive.conectado ? (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={desconectarDrive}
                >
                  Desconectar Google Drive
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={conectarDrive}
                >
                  Conectar Google Drive
                </button>
              )}
            </div>
          </>
        ) : (
          <p className="copias-ayuda">
            Google Drive todavía no está configurado. Define{" "}
            <code>GOOGLE_DRIVE_CLIENT_ID</code> y{" "}
            <code>GOOGLE_DRIVE_CLIENT_SECRET</code> en{" "}
            <code>backend/.env</code> y reinicia el backend. Mientras tanto,
            puedes descargar los archivos y subirlos manualmente a Drive.
          </p>
        )}
      </div>

      {/* ================================= */}
      {/* MODAL DE RESTAURACIÓN */}
      {/* ================================= */}

      {copiaARestaurar && (
        <div
          className="modal-overlay"
          role="presentation"
          onClick={cerrarRestauracion}
        >
          <div
            className="modal-perfil modal-restauracion"
            role="dialog"
            aria-modal="true"
            aria-labelledby="restauracion-titulo"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-perfil-cabecera">
              <h3 id="restauracion-titulo">Restaurar copia de seguridad</h3>

              <button
                type="button"
                className="btn-cerrar-modal"
                aria-label="Cerrar"
                onClick={cerrarRestauracion}
              >
                ×
              </button>
            </div>

            <div className="modal-restauracion-aviso">
              <p>
                Vas a restaurar <strong>{copiaARestaurar.nombre}</strong>.
              </p>

              <p>
                Esta operación <strong>sobrescribe los datos actuales</strong>{" "}
                de la base de datos. Antes de restaurar se intenta guardar una
                copia del estado actual.
              </p>

              <p>
                Escribe <strong>RESTAURAR</strong> para confirmar.
              </p>
            </div>

            <input
              type="text"
              className="modal-restauracion-input"
              value={confirmacionRestaurar}
              onChange={(event) =>
                setConfirmacionRestaurar(event.target.value)
              }
              placeholder="RESTAURAR"
              aria-label="Confirmación de restauración"
            />

            <div className="copias-form-acciones">
              <button
                type="button"
                className="btn-secondary"
                onClick={cerrarRestauracion}
                disabled={restaurando}
              >
                Cancelar
              </button>

              <button
                type="button"
                className="btn-eliminar-dia"
                onClick={restaurarCopia}
                disabled={
                  restaurando || confirmacionRestaurar !== "RESTAURAR"
                }
              >
                {restaurando ? "Restaurando..." : "Restaurar ahora"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default BackupView;
