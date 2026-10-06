import { useEffect, useMemo, useState } from "react";
import "./App.css";

const API_BASE = "http://localhost:3000/api";

const normalizarActivo = (valor) => valor === true || valor === 1;

const formatearFecha = (fecha) => {
  if (!fecha) {
    return "";
  }

  return new Date(fecha).toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
};

const formatearHora = (hora) => {
  if (!hora) {
    return "--:--";
  }

  return String(hora).slice(0, 5);
};

function App() {
  const [imagen, setImagen] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [error, setError] = useState("");

  const [casas, setCasas] = useState([]);
  const [trabajadores, setTrabajadores] = useState([]);
  const [cargandoDatos, setCargandoDatos] = useState(true);

  const [editandoIndex, setEditandoIndex] = useState(null);

  const [fecha, setFecha] = useState(new Date().toISOString().split("T")[0]);

  const [guardando, setGuardando] = useState(false);

  // =========================================
  // GESTIÓN DE CASAS Y TRABAJADORES
  // =========================================

  const [mostrarGestion, setMostrarGestion] = useState(false);

  const [nuevoTrabajador, setNuevoTrabajador] = useState({
    nombre: "",
    codigo: "",
  });

  const [nuevaCasa, setNuevaCasa] = useState({
    nombre: "",
    direccion: "",
    duracion_minutos: "",
  });

  const [trabajadorEditando, setTrabajadorEditando] = useState(null);
  const [casaEditando, setCasaEditando] = useState(null);

  const [guardandoTrabajador, setGuardandoTrabajador] = useState(false);
  const [guardandoCasa, setGuardandoCasa] = useState(false);

  const [mostrarHistorial, setMostrarHistorial] = useState(false);
  const [historial, setHistorial] = useState([]);
  const [diaHistorial, setDiaHistorial] = useState(null);
  const [serviciosHistorial, setServiciosHistorial] = useState([]);
  const [cargandoHistorial, setCargandoHistorial] = useState(false);

  const casasActivas = useMemo(
    () => casas.filter((casa) => normalizarActivo(casa.activo)),
    [casas],
  );

  const trabajadoresActivos = useMemo(
    () =>
      trabajadores.filter((trabajador) => normalizarActivo(trabajador.activo)),
    [trabajadores],
  );

  // =========================================
  // CARGAR CASAS Y TRABAJADORES
  // =========================================

  const cargarDatos = async () => {
    try {
      setCargandoDatos(true);

      const [respuestaCasas, respuestaTrabajadores] = await Promise.all([
        fetch(`${API_BASE}/casas`),
        fetch(`${API_BASE}/trabajadores`),
      ]);

      const datosCasas = await respuestaCasas.json();
      const datosTrabajadores = await respuestaTrabajadores.json();

      if (!respuestaCasas.ok || !datosCasas.ok) {
        throw new Error("Error cargando casas");
      }

      if (!respuestaTrabajadores.ok || !datosTrabajadores.ok) {
        throw new Error("Error cargando trabajadores");
      }

      setCasas(datosCasas.casas || []);
      setTrabajadores(datosTrabajadores.trabajadores || []);
    } catch (error) {
      console.error(error);
      setError(error.message);
    } finally {
      setCargandoDatos(false);
    }
  };

  const cargarHistorial = async () => {
    try {
      setCargandoHistorial(true);

      const respuesta = await fetch(`${API_BASE}/horarios/historial`);
      const datos = await respuesta.json();

      if (!respuesta.ok || !datos.ok) {
        throw new Error(datos.error || "Error cargando historial");
      }

      setHistorial(datos.dias || []);
    } catch (error) {
      console.error(error);
      setError(error.message);
    } finally {
      setCargandoHistorial(false);
    }
  };

  useEffect(() => {
    Promise.resolve().then(() => {
      cargarDatos();
      cargarHistorial();
    });
  }, []);

  const abrirDiaHistorial = async (diaId) => {
    try {
      setCargandoHistorial(true);
      setError("");

      const respuesta = await fetch(`${API_BASE}/horarios/historial/${diaId}`);
      const datos = await respuesta.json();

      if (!respuesta.ok || !datos.ok) {
        throw new Error(datos.error || "Error cargando el día del historial");
      }

      setDiaHistorial(datos.dia);
      setServiciosHistorial(datos.servicios || []);
    } catch (error) {
      console.error(error);
      setError(error.message);
    } finally {
      setCargandoHistorial(false);
    }
  };

  // =========================================
  // CREAR TRABAJADOR
  // =========================================

  const crearTrabajador = async (event) => {
    event.preventDefault();

    if (!nuevoTrabajador.nombre.trim() || !nuevoTrabajador.codigo.trim()) {
      setError("Escribe el nombre y el código del trabajador.");
      return;
    }

    setGuardandoTrabajador(true);
    setError("");

    try {
      const respuesta = await fetch(
        `${API_BASE}/trabajadores`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            nombre: nuevoTrabajador.nombre.trim(),
            codigo: nuevoTrabajador.codigo.trim().toUpperCase(),
          }),
        },
      );

      const datos = await respuesta.json();

      if (!respuesta.ok || !datos.ok) {
        throw new Error(datos.error || "Error creando trabajador");
      }

      setNuevoTrabajador({
        nombre: "",
        codigo: "",
      });

      await cargarDatos();

      alert("Trabajador creado correctamente.");
    } catch (error) {
      console.error(error);
      setError(error.message);
    } finally {
      setGuardandoTrabajador(false);
    }
  };

  const guardarTrabajadorEditado = async (event) => {
    event.preventDefault();

    if (!trabajadorEditando?.nombre.trim() || !trabajadorEditando?.codigo.trim()) {
      setError("Escribe el nombre y el código del trabajador.");
      return;
    }

    setGuardandoTrabajador(true);
    setError("");

    try {
      const respuesta = await fetch(
        `${API_BASE}/trabajadores/${trabajadorEditando.id}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            nombre: trabajadorEditando.nombre.trim(),
            codigo: trabajadorEditando.codigo.trim().toUpperCase(),
          }),
        },
      );

      const datos = await respuesta.json();

      if (!respuesta.ok || !datos.ok) {
        throw new Error(datos.error || "Error actualizando trabajador");
      }

      setTrabajadorEditando(null);
      await cargarDatos();
    } catch (error) {
      console.error(error);
      setError(error.message);
    } finally {
      setGuardandoTrabajador(false);
    }
  };

  const cambiarActivoTrabajador = async (trabajador) => {
    try {
      setError("");

      const respuesta = await fetch(
        `${API_BASE}/trabajadores/${trabajador.id}/activo`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            activo: !normalizarActivo(trabajador.activo),
          }),
        },
      );

      const datos = await respuesta.json();

      if (!respuesta.ok || !datos.ok) {
        throw new Error(datos.error || "Error cambiando trabajador");
      }

      await cargarDatos();
    } catch (error) {
      console.error(error);
      setError(error.message);
    }
  };

  // =========================================
  // CREAR CASA
  // =========================================

  const crearCasa = async (event) => {
    event.preventDefault();

    if (!nuevaCasa.nombre.trim()) {
      setError("Escribe el nombre de la casa.");
      return;
    }

    setGuardandoCasa(true);
    setError("");

    try {
      const respuesta = await fetch(
        `${API_BASE}/casas`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            nombre: nuevaCasa.nombre.trim(),
            direccion: nuevaCasa.direccion.trim() || null,
            duracion_minutos: nuevaCasa.duracion_minutos
              ? Number(nuevaCasa.duracion_minutos)
              : null,
          }),
        },
      );

      const datos = await respuesta.json();

      if (!respuesta.ok || !datos.ok) {
        throw new Error(datos.error || "Error creando casa");
      }

      setNuevaCasa({
        nombre: "",
        direccion: "",
        duracion_minutos: "",
      });

      await cargarDatos();

      alert("Casa creada correctamente.");
    } catch (error) {
      console.error(error);
      setError(error.message);
    } finally {
      setGuardandoCasa(false);
    }
  };

  const guardarCasaEditada = async (event) => {
    event.preventDefault();

    if (!casaEditando?.nombre.trim()) {
      setError("Escribe el nombre de la casa.");
      return;
    }

    setGuardandoCasa(true);
    setError("");

    try {
      const respuesta = await fetch(`${API_BASE}/casas/${casaEditando.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          nombre: casaEditando.nombre.trim(),
          direccion: casaEditando.direccion?.trim() || null,
          duracion_minutos: casaEditando.duracion_minutos
            ? Number(casaEditando.duracion_minutos)
            : null,
        }),
      });

      const datos = await respuesta.json();

      if (!respuesta.ok || !datos.ok) {
        throw new Error(datos.error || "Error actualizando casa");
      }

      setCasaEditando(null);
      await cargarDatos();
    } catch (error) {
      console.error(error);
      setError(error.message);
    } finally {
      setGuardandoCasa(false);
    }
  };

  const cambiarActivoCasa = async (casa) => {
    try {
      setError("");

      const respuesta = await fetch(`${API_BASE}/casas/${casa.id}/activo`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          activo: !normalizarActivo(casa.activo),
        }),
      });

      const datos = await respuesta.json();

      if (!respuesta.ok || !datos.ok) {
        throw new Error(datos.error || "Error cambiando casa");
      }

      await cargarDatos();
    } catch (error) {
      console.error(error);
      setError(error.message);
    }
  };

  // =========================================
  // SELECCIONAR IMAGEN
  // =========================================

  const seleccionarImagen = (event) => {
    const archivo = event.target.files[0];

    if (!archivo) {
      return;
    }

    setImagen(archivo);
    setResultado(null);
    setError("");
    setEditandoIndex(null);
  };

  // =========================================
  // ANALIZAR IMAGEN
  // =========================================

  const analizarImagen = async () => {
    if (!imagen) {
      setError("Selecciona una imagen primero.");
      return;
    }

    setCargando(true);
    setError("");
    setResultado(null);
    setEditandoIndex(null);

    try {
      const formData = new FormData();
      formData.append("imagen", imagen);

      const respuesta = await fetch(
        `${API_BASE}/horarios/analizar`,
        {
          method: "POST",
          body: formData,
        },
      );

      const datos = await respuesta.json();

      if (!respuesta.ok) {
        throw new Error(datos.error || "Error analizando la imagen");
      }

      setResultado(datos);
    } catch (error) {
      console.error(error);
      setError(error.message);
    } finally {
      setCargando(false);
    }
  };

  // =========================================
  // ACTUALIZAR SERVICIO
  // =========================================

  const actualizarServicio = (index, campo, valor) => {
    setResultado((actual) => {
      const serviciosActualizados = [...actual.servicios];

      const servicio = {
        ...serviciosActualizados[index],
      };

      // ---------------------------------
      // CAMBIAR CASA
      // ---------------------------------

      if (campo === "casa") {
        const casaSeleccionada = casasActivas.find(
          (casa) => casa.id === Number(valor),
        );

        if (casaSeleccionada) {
          servicio.casa = {
            nombre: casaSeleccionada.nombre,
            encontrada: true,
            datos: casaSeleccionada,
          };
        }
      }

      // ---------------------------------
      // OTROS CAMPOS
      // ---------------------------------
      else {
        servicio[campo] = valor;
      }

      serviciosActualizados[index] = servicio;

      return {
        ...actual,
        servicios: serviciosActualizados,
      };
    });
  };

  // =========================================
  // ACTUALIZAR TRABAJADOR
  // =========================================

  const actualizarTrabajador = (servicioIndex, trabajadorIndex, codigo) => {
    setResultado((actual) => {
      const serviciosActualizados = [...actual.servicios];

      const servicio = {
        ...serviciosActualizados[servicioIndex],
      };

      const trabajadoresActualizados = [...servicio.trabajadores];

      const trabajadorEncontrado = trabajadoresActivos.find(
        (item) => item.codigo === codigo,
      );

      if (!trabajadorEncontrado) {
        return actual;
      }

      trabajadoresActualizados[trabajadorIndex] = {
        encontrado: true,
        trabajador: trabajadorEncontrado,
      };

      servicio.trabajadores = trabajadoresActualizados;

      serviciosActualizados[servicioIndex] = servicio;

      return {
        ...actual,
        servicios: serviciosActualizados,
      };
    });
  };

  // =========================================
  // AÑADIR TRABAJADOR
  // =========================================

  const añadirTrabajador = (servicioIndex) => {
    setResultado((actual) => {
      const serviciosActualizados = [...actual.servicios];

      const servicio = {
        ...serviciosActualizados[servicioIndex],
      };

      servicio.trabajadores = [
        ...servicio.trabajadores,
        {
          encontrado: false,
          codigo: "",
        },
      ];

      serviciosActualizados[servicioIndex] = servicio;

      return {
        ...actual,
        servicios: serviciosActualizados,
      };
    });
  };

  // =========================================
  // ELIMINAR TRABAJADOR
  // =========================================

  const eliminarTrabajador = (servicioIndex, trabajadorIndex) => {
    setResultado((actual) => {
      const serviciosActualizados = [...actual.servicios];

      const servicio = {
        ...serviciosActualizados[servicioIndex],
      };

      servicio.trabajadores = servicio.trabajadores.filter(
        (_, index) => index !== trabajadorIndex,
      );

      serviciosActualizados[servicioIndex] = servicio;

      return {
        ...actual,
        servicios: serviciosActualizados,
      };
    });
  };

  // =========================================
  // COMPROBAR ERRORES
  // =========================================

  const servicioTieneErrores = (servicio) => {
    return (
      !servicio.casa.encontrada ||
      !servicio.hora_inicio ||
      !servicio.hora_fin ||
      servicio.trabajadores.some(
        (trabajador) => !trabajador.encontrado || !trabajador.trabajador,
      )
    );
  };

  // =========================================
  // CONTAR ERRORES
  // =========================================

  const contarErrores = () => {
    if (!resultado) {
      return 0;
    }

    return resultado.servicios.filter(servicioTieneErrores).length;
  };

  // =========================================
  // GUARDAR HORARIO COMPLETO
  // =========================================

  const guardarHorario = async () => {
    if (!resultado || !resultado.servicios.length) {
      setError("No hay servicios para guardar.");
      return;
    }

    const errores = resultado.servicios.filter(servicioTieneErrores);

    if (errores.length > 0) {
      setError(`Hay ${errores.length} servicios pendientes de revisar.`);
      return;
    }

    if (!fecha) {
      setError("Selecciona una fecha.");
      return;
    }

    setGuardando(true);
    setError("");

    try {
      const serviciosParaGuardar = resultado.servicios.map((servicio) => ({
        casa_id: servicio.casa.datos.id,
        casa: servicio.casa.nombre,
        hora_inicio: servicio.hora_inicio,
        hora_fin: servicio.hora_fin,
        trabajadores: servicio.trabajadores.map(
          (trabajador) => trabajador.trabajador.id,
        ),
      }));

      const respuesta = await fetch(
        `${API_BASE}/horarios/guardar-completo`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            fecha,
            imagen_original: imagen?.name || null,
            servicios: serviciosParaGuardar,
          }),
        },
      );

      const datos = await respuesta.json();

      if (!respuesta.ok || !datos.ok) {
        throw new Error(datos.error || "Error guardando el horario");
      }

      alert(
        `Horario guardado correctamente.\n\n` +
          `Servicios guardados: ${datos.servicios_guardados}`,
      );
      await cargarHistorial();
    } catch (error) {
      console.error(error);
      setError(error.message);
    } finally {
      setGuardando(false);
    }
  };

  // =========================================
  // RENDER
  // =========================================

  return (
    <div className="app">
      {/* ================================= */}
      {/* HEADER */}
      {/* ================================= */}

      <header className="header">
        <div className="header-content">
          <h1>Gestor de Horarios</h1>

          <p>Analiza y revisa los horarios mediante IA</p>
        </div>
      </header>

      <main className="container">
        {/* ================================= */}
        {/* DATOS */}
        {/* ================================= */}

        {!cargandoDatos && (
          <div className="datos-referencia">
            <div className="dato-box">
              <span>Casas activas</span>
              <strong>{casasActivas.length}</strong>
            </div>

            <div className="dato-box">
              <span>Trabajadores activos</span>
              <strong>{trabajadoresActivos.length}</strong>
            </div>

            <div className="dato-box">
              <span>Días guardados</span>
              <strong>{historial.length}</strong>
            </div>
          </div>
        )}

        {/* ================================= */}
        {/* GESTIÓN */}
        {/* ================================= */}

        <section className="card">
          <div className="gestion-header">
            <div>
              <h2>⚙️ Gestión</h2>

              <p>Administra las casas y trabajadores registrados.</p>
            </div>

            <button
              type="button"
              className="btn-secondary"
              onClick={() => setMostrarGestion(!mostrarGestion)}
            >
              {mostrarGestion ? "Ocultar gestión" : "Abrir gestión"}
            </button>
          </div>

          {mostrarGestion && (
            <div className="gestion-grid">
              {/* ============================== */}
              {/* TRABAJADORES */}
              {/* ============================== */}

              <div className="gestion-box">
                <h3>👥 Trabajadores</h3>

                <div className="lista-gestion">
                  {trabajadores.length === 0 ? (
                    <p className="gestion-vacio">
                      No hay trabajadores registrados.
                    </p>
                  ) : (
                    trabajadores.map((trabajador) => (
                      <div
                        className={`item-gestion ${
                          normalizarActivo(trabajador.activo)
                            ? ""
                            : "item-inactivo"
                        }`}
                        key={trabajador.id}
                      >
                        <div>
                          <strong>{trabajador.nombre}</strong>
                          <span>{trabajador.codigo}</span>
                          <span>
                            {normalizarActivo(trabajador.activo)
                              ? "Activo"
                              : "Inactivo"}
                          </span>
                        </div>

                        <div className="item-acciones">
                          <button
                            type="button"
                            className="btn-mini"
                            onClick={() => setTrabajadorEditando(trabajador)}
                          >
                            Editar
                          </button>

                          <button
                            type="button"
                            className="btn-mini"
                            onClick={() => cambiarActivoTrabajador(trabajador)}
                          >
                            {normalizarActivo(trabajador.activo)
                              ? "Desactivar"
                              : "Activar"}
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <form
                  onSubmit={
                    trabajadorEditando
                      ? guardarTrabajadorEditado
                      : crearTrabajador
                  }
                >
                  <h4>
                    {trabajadorEditando
                      ? "Editar trabajador"
                      : "Añadir trabajador"}
                  </h4>

                  <input
                    type="text"
                    placeholder="Nombre"
                    value={
                      trabajadorEditando
                        ? trabajadorEditando.nombre
                        : nuevoTrabajador.nombre
                    }
                    onChange={(event) =>
                      trabajadorEditando
                        ? setTrabajadorEditando({
                            ...trabajadorEditando,
                            nombre: event.target.value,
                          })
                        : setNuevoTrabajador({
                            ...nuevoTrabajador,
                            nombre: event.target.value,
                          })
                    }
                  />

                  <input
                    type="text"
                    placeholder="Código"
                    maxLength="10"
                    value={
                      trabajadorEditando
                        ? trabajadorEditando.codigo
                        : nuevoTrabajador.codigo
                    }
                    onChange={(event) =>
                      trabajadorEditando
                        ? setTrabajadorEditando({
                            ...trabajadorEditando,
                            codigo: event.target.value.toUpperCase(),
                          })
                        : setNuevoTrabajador({
                            ...nuevoTrabajador,
                            codigo: event.target.value.toUpperCase(),
                          })
                    }
                  />

                  <div className="form-actions">
                    <button
                      type="submit"
                      className="btn-primary"
                      disabled={guardandoTrabajador}
                    >
                      {guardandoTrabajador
                        ? "Guardando..."
                        : trabajadorEditando
                          ? "Guardar cambios"
                          : "+ Añadir trabajador"}
                    </button>

                    {trabajadorEditando && (
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => setTrabajadorEditando(null)}
                      >
                        Cancelar
                      </button>
                    )}
                  </div>
                </form>
              </div>

              {/* ============================== */}
              {/* CASAS */}
              {/* ============================== */}

              <div className="gestion-box">
                <h3>🏠 Casas</h3>

                <div className="lista-gestion">
                  {casas.length === 0 ? (
                    <p className="gestion-vacio">No hay casas registradas.</p>
                  ) : (
                    casas.map((casa) => (
                      <div
                        className={`item-gestion ${
                          normalizarActivo(casa.activo) ? "" : "item-inactivo"
                        }`}
                        key={casa.id}
                      >
                        <div>
                          <strong>{casa.nombre}</strong>
                          <span>{casa.duracion_minutos || "-"} min</span>
                          <span>{casa.direccion || "Sin dirección"}</span>
                          <span>
                            {normalizarActivo(casa.activo)
                              ? "Activa"
                              : "Inactiva"}
                          </span>
                        </div>

                        <div className="item-acciones">
                          <button
                            type="button"
                            className="btn-mini"
                            onClick={() =>
                              setCasaEditando({
                                ...casa,
                                duracion_minutos:
                                  casa.duracion_minutos?.toString() || "",
                              })
                            }
                          >
                            Editar
                          </button>

                          <button
                            type="button"
                            className="btn-mini"
                            onClick={() => cambiarActivoCasa(casa)}
                          >
                            {normalizarActivo(casa.activo)
                              ? "Desactivar"
                              : "Activar"}
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <form onSubmit={casaEditando ? guardarCasaEditada : crearCasa}>
                  <h4>{casaEditando ? "Editar casa" : "Añadir casa"}</h4>

                  <input
                    type="text"
                    placeholder="Nombre de la casa"
                    value={casaEditando ? casaEditando.nombre : nuevaCasa.nombre}
                    onChange={(event) =>
                      casaEditando
                        ? setCasaEditando({
                            ...casaEditando,
                            nombre: event.target.value,
                          })
                        : setNuevaCasa({
                            ...nuevaCasa,
                            nombre: event.target.value,
                          })
                    }
                  />

                  <input
                    type="text"
                    placeholder="Dirección (opcional)"
                    value={
                      casaEditando ? casaEditando.direccion || "" : nuevaCasa.direccion
                    }
                    onChange={(event) =>
                      casaEditando
                        ? setCasaEditando({
                            ...casaEditando,
                            direccion: event.target.value,
                          })
                        : setNuevaCasa({
                            ...nuevaCasa,
                            direccion: event.target.value,
                          })
                    }
                  />

                  <input
                    type="number"
                    min="1"
                    placeholder="Duración base en minutos"
                    value={
                      casaEditando
                        ? casaEditando.duracion_minutos || ""
                        : nuevaCasa.duracion_minutos
                    }
                    onChange={(event) =>
                      casaEditando
                        ? setCasaEditando({
                            ...casaEditando,
                            duracion_minutos: event.target.value,
                          })
                        : setNuevaCasa({
                            ...nuevaCasa,
                            duracion_minutos: event.target.value,
                          })
                    }
                  />

                  <div className="form-actions">
                    <button
                      type="submit"
                      className="btn-primary"
                      disabled={guardandoCasa}
                    >
                      {guardandoCasa
                        ? "Guardando..."
                        : casaEditando
                          ? "Guardar cambios"
                          : "+ Añadir casa"}
                    </button>

                    {casaEditando && (
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => setCasaEditando(null)}
                      >
                        Cancelar
                      </button>
                    )}
                  </div>
                </form>
              </div>
            </div>
          )}
        </section>

        {/* ================================= */}
        {/* HISTORIAL */}
        {/* ================================= */}

        <section className="card">
          <div className="gestion-header">
            <div>
              <h2>Historial</h2>

              <p>Consulta los horarios guardados sin modificarlos.</p>
            </div>

            <button
              type="button"
              className="btn-secondary"
              onClick={() => setMostrarHistorial(!mostrarHistorial)}
            >
              {mostrarHistorial ? "Ocultar historial" : "Abrir historial"}
            </button>
          </div>

          {mostrarHistorial && (
            <div className="historial-layout">
              <div className="historial-lista">
                {cargandoHistorial && historial.length === 0 ? (
                  <p className="gestion-vacio">Cargando historial...</p>
                ) : historial.length === 0 ? (
                  <p className="gestion-vacio">No hay horarios guardados.</p>
                ) : (
                  historial.map((dia) => (
                    <button
                      type="button"
                      className={`historial-dia ${
                        diaHistorial?.id === dia.id ? "seleccionado" : ""
                      }`}
                      key={dia.id}
                      onClick={() => abrirDiaHistorial(dia.id)}
                    >
                      <strong>{formatearFecha(dia.fecha)}</strong>
                      <span>{dia.total_servicios} servicios</span>
                      <span>{dia.estado}</span>
                    </button>
                  ))
                )}
              </div>

              <div className="historial-detalle">
                {!diaHistorial ? (
                  <p className="gestion-vacio">Selecciona un día.</p>
                ) : (
                  <>
                    <div className="historial-detalle-header">
                      <h3>{formatearFecha(diaHistorial.fecha)}</h3>

                      <span>{serviciosHistorial.length} servicios</span>
                    </div>

                    <div className="historial-servicios">
                      {serviciosHistorial.map((servicio) => (
                        <div className="historial-servicio" key={servicio.id}>
                          <div>
                            <strong>{servicio.casa}</strong>

                            <span>
                              {formatearHora(servicio.hora_inicio)} →{" "}
                              {formatearHora(servicio.hora_fin)}
                            </span>
                          </div>

                          <div className="trabajadores-celda">
                            {servicio.trabajadores.map((trabajador) => (
                              <span
                                className="trabajador-tag"
                                key={trabajador.id}
                              >
                                {trabajador.codigo}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </section>

        {/* ================================= */}
        {/* ANALIZAR */}
        {/* ================================= */}

        <section className="card">
          <div className="card-title">
            <h2>Analizar horario</h2>

            <p>Selecciona una imagen del horario para analizarla.</p>
          </div>

          <div className="upload-area">
            <input
              id="imagen"
              type="file"
              accept="image/*"
              onChange={seleccionarImagen}
            />

            <label htmlFor="imagen" className="file-button">
              Seleccionar archivo
            </label>

            {imagen && <span className="file-name">{imagen.name}</span>}
          </div>

          {imagen && (
            <div className="archivo">
              <strong>Imagen:</strong>
              <span>{imagen.name}</span>
            </div>
          )}

          <button
            className="btn-primary"
            onClick={analizarImagen}
            disabled={!imagen || cargando}
          >
            {cargando ? "Analizando..." : "Analizar horario"}
          </button>

          {error && <div className="error">{error}</div>}
        </section>

        {/* ================================= */}
        {/* RESULTADO */}
        {/* ================================= */}

        {resultado && (
          <section className="card">
            <div className="resultado-header">
              <div>
                <h2>Revisar horario</h2>

                <p>{resultado.servicios.length} servicios detectados</p>
              </div>

              <div className="guardar-panel">
                <label>Fecha</label>

                <input
                  type="date"
                  value={fecha}
                  onChange={(event) => setFecha(event.target.value)}
                />

                <div
                  className={
                    contarErrores() > 0
                      ? "resumen-estado pendiente"
                      : "resumen-estado correcto"
                  }
                >
                  {contarErrores() > 0
                    ? `${contarErrores()} pendientes`
                    : "✓ Todo correcto"}
                </div>

                <button
                  type="button"
                  className="btn-guardar-horario"
                  onClick={guardarHorario}
                  disabled={guardando || contarErrores() > 0}
                >
                  {guardando ? "Guardando..." : "💾 Guardar horario"}
                </button>
              </div>
            </div>

            <div className="tabla-horarios">
              {resultado.servicios.map((servicio, index) => {
                const estaEditando = editandoIndex === index;

                const tieneErrores = servicioTieneErrores(servicio);

                // =================================
                // EDICIÓN
                // =================================

                if (estaEditando) {
                  return (
                    <div className="fila-horario fila-edicion" key={index}>
                      {/* CASA */}

                      <div className="celda casa-edicion">
                        <label>Casa</label>

                        <select
                          value={
                            servicio.casa.encontrada
                              ? servicio.casa.datos.id
                              : ""
                          }
                          className={
                            !servicio.casa.encontrada ? "select-warning" : ""
                          }
                          onChange={(event) =>
                            actualizarServicio(
                              index,
                              "casa",
                              event.target.value,
                            )
                          }
                        >
                          {!servicio.casa.encontrada && (
                            <option value="">
                              ⚠️ {servicio.casa.nombre}
                              {" — no registrada"}
                            </option>
                          )}

                          {casasActivas.map((casa) => (
                            <option key={casa.id} value={casa.id}>
                              {casa.nombre}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* HORARIO */}

                      <div className="celda horario-edicion">
                        <div>
                          <label>Inicio</label>

                          <input
                            type="time"
                            value={servicio.hora_inicio || ""}
                            onChange={(event) =>
                              actualizarServicio(
                                index,
                                "hora_inicio",
                                event.target.value,
                              )
                            }
                          />
                        </div>

                        <span>→</span>

                        <div>
                          <label>Fin</label>

                          <input
                            type="time"
                            value={servicio.hora_fin || ""}
                            onChange={(event) =>
                              actualizarServicio(
                                index,
                                "hora_fin",
                                event.target.value,
                              )
                            }
                          />
                        </div>
                      </div>

                      {/* TRABAJADORES */}

                      <div className="celda trabajadores-edicion-container">
                        <label>Trabajadores</label>

                        <div className="trabajadores-edicion">
                          {servicio.trabajadores.map(
                            (trabajador, trabajadorIndex) => (
                              <div
                                className="trabajador-edicion"
                                key={trabajadorIndex}
                              >
                                <select
                                  value={
                                    trabajador.encontrado
                                      ? trabajador.trabajador.codigo
                                      : ""
                                  }
                                  className={
                                    !trabajador.encontrado
                                      ? "select-warning"
                                      : ""
                                  }
                                  onChange={(event) =>
                                    actualizarTrabajador(
                                      index,
                                      trabajadorIndex,
                                      event.target.value,
                                    )
                                  }
                                >
                                  {!trabajador.encontrado && (
                                    <option value="">
                                      ⚠️{" "}
                                      {trabajador.codigo || "Sin seleccionar"}
                                      {" — no registrado"}
                                    </option>
                                  )}

                                  {trabajadoresActivos.map((item) => (
                                    <option key={item.id} value={item.codigo}>
                                      {item.codigo}
                                      {" - "}
                                      {item.nombre}
                                    </option>
                                  ))}
                                </select>

                                <button
                                  type="button"
                                  className="btn-x"
                                  onClick={() =>
                                    eliminarTrabajador(index, trabajadorIndex)
                                  }
                                >
                                  ×
                                </button>
                              </div>
                            ),
                          )}
                        </div>

                        <button
                          type="button"
                          className="btn-anadir"
                          onClick={() => añadirTrabajador(index)}
                        >
                          + Trabajador
                        </button>
                      </div>

                      {/* LISTO */}

                      <div className="acciones">
                        <button
                          type="button"
                          className="btn-guardar-edicion"
                          onClick={() => setEditandoIndex(null)}
                        >
                          ✓ Listo
                        </button>
                      </div>
                    </div>
                  );
                }

                // =================================
                // VISTA NORMAL
                // =================================

                return (
                  <div
                    className={`fila-horario ${
                      tieneErrores ? "fila-con-error" : ""
                    }`}
                    key={index}
                  >
                    {/* CASA */}

                    <div className="celda casa-celda">
                      <strong>{servicio.casa.nombre}</strong>

                      {!servicio.casa.encontrada && (
                        <span className="mini-warning">⚠️ No registrada</span>
                      )}
                    </div>

                    {/* HORARIO */}

                    <div className="celda horario-celda">
                      <strong>{servicio.hora_inicio || "--:--"}</strong>

                      <span>→</span>

                      <strong>{servicio.hora_fin || "--:--"}</strong>

                      {!servicio.hora_fin && (
                        <span className="mini-warning">⚠️ Falta hora</span>
                      )}
                    </div>

                    {/* TRABAJADORES */}

                    <div className="celda trabajadores-celda">
                      {servicio.trabajadores.map(
                        (trabajador, trabajadorIndex) => (
                          <span
                            key={trabajadorIndex}
                            className={
                              trabajador.encontrado
                                ? "trabajador-tag"
                                : "trabajador-tag trabajador-desconocido"
                            }
                          >
                            {trabajador.encontrado
                              ? trabajador.trabajador.codigo
                              : `⚠️ ${trabajador.codigo}`}
                          </span>
                        ),
                      )}
                    </div>

                    {/* EDITAR */}

                    <div className="acciones">
                      <button
                        type="button"
                        className="btn-editar"
                        onClick={() => setEditandoIndex(index)}
                      >
                        ✏️ Editar
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
