import { useEffect, useState } from "react";
import "./App.css";

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

  const [guardandoTrabajador, setGuardandoTrabajador] = useState(false);
  const [guardandoCasa, setGuardandoCasa] = useState(false);

  // =========================================
  // CARGAR CASAS Y TRABAJADORES
  // =========================================

  useEffect(() => {
    cargarDatos();
  }, []);

  const cargarDatos = async () => {
    try {
      setCargandoDatos(true);

      const [respuestaCasas, respuestaTrabajadores] = await Promise.all([
        fetch("http://localhost:3000/api/horarios/casas"),
        fetch("http://localhost:3000/api/horarios/trabajadores"),
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
        "http://localhost:3000/api/horarios/trabajadores",
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
        "http://localhost:3000/api/horarios/casas",
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
        "http://localhost:3000/api/horarios/analizar",
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
        const casaSeleccionada = casas.find(
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

      const trabajadorEncontrado = trabajadores.find(
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
        "http://localhost:3000/api/horarios/guardar-completo",
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
              <span>Casas</span>
              <strong>{casas.length}</strong>
            </div>

            <div className="dato-box">
              <span>Trabajadores</span>
              <strong>{trabajadores.length}</strong>
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
                      <div className="item-gestion" key={trabajador.id}>
                        <div>
                          <strong>{trabajador.nombre}</strong>

                          <span>{trabajador.codigo}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <form onSubmit={crearTrabajador}>
                  <h4>Añadir trabajador</h4>

                  <input
                    type="text"
                    placeholder="Nombre"
                    value={nuevoTrabajador.nombre}
                    onChange={(event) =>
                      setNuevoTrabajador({
                        ...nuevoTrabajador,
                        nombre: event.target.value,
                      })
                    }
                  />

                  <input
                    type="text"
                    placeholder="Código"
                    maxLength="10"
                    value={nuevoTrabajador.codigo}
                    onChange={(event) =>
                      setNuevoTrabajador({
                        ...nuevoTrabajador,
                        codigo: event.target.value.toUpperCase(),
                      })
                    }
                  />

                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={guardandoTrabajador}
                  >
                    {guardandoTrabajador
                      ? "Guardando..."
                      : "+ Añadir trabajador"}
                  </button>
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
                      <div className="item-gestion" key={casa.id}>
                        <div>
                          <strong>{casa.nombre}</strong>

                          {casa.duracion_minutos && (
                            <span>{casa.duracion_minutos} min</span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <form onSubmit={crearCasa}>
                  <h4>Añadir casa</h4>

                  <input
                    type="text"
                    placeholder="Nombre de la casa"
                    value={nuevaCasa.nombre}
                    onChange={(event) =>
                      setNuevaCasa({
                        ...nuevaCasa,
                        nombre: event.target.value,
                      })
                    }
                  />

                  <input
                    type="text"
                    placeholder="Dirección (opcional)"
                    value={nuevaCasa.direccion}
                    onChange={(event) =>
                      setNuevaCasa({
                        ...nuevaCasa,
                        direccion: event.target.value,
                      })
                    }
                  />

                  <input
                    type="number"
                    min="1"
                    placeholder="Duración base en minutos"
                    value={nuevaCasa.duracion_minutos}
                    onChange={(event) =>
                      setNuevaCasa({
                        ...nuevaCasa,
                        duracion_minutos: event.target.value,
                      })
                    }
                  />

                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={guardandoCasa}
                  >
                    {guardandoCasa ? "Guardando..." : "+ Añadir casa"}
                  </button>
                </form>
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

                          {casas.map((casa) => (
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

                                  {trabajadores.map((item) => (
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
