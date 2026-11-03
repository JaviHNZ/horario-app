import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

const API_BASE = "http://localhost:3000/api";

const formatearMinutos = (minutos) => {
  const total = Number(minutos) || 0;
  const horas = Math.floor(total / 60);
  const resto = total % 60;
  if (horas === 0) return `${resto} min`;
  if (resto === 0) return `${horas} h`;
  return `${horas} h ${resto} min`;
};

const formatearFecha = (fecha) => {
  if (!fecha) return "";
  return new Date(fecha).toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
};

const redondear2 = (valor) => Math.round((Number(valor) || 0) * 100) / 100;

const etiquetaEstado = {
  borrador: "Borrador",
  emitida: "Emitida",
  pagada: "Pagada",
  anulada: "Anulada",
};

export default function FacturasView() {
  const { id: casaId } = useParams();
  const navigate = useNavigate();

  const [casas, setCasas] = useState([]);
  const [cargandoCasas, setCargandoCasas] = useState(false);
  const [visitas, setVisitas] = useState([]);
  const [cargandoVisitas, setCargandoVisitas] = useState(false);
  const [facturas, setFacturas] = useState([]);
  const [cargandoFacturas, setCargandoFacturas] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");

  const [mes, setMes] = useState(new Date().getMonth() + 1);
  const [anio, setAnio] = useState(new Date().getFullYear());

  const [seleccionadas, setSeleccionadas] = useState([]);
  const [precioPorHora, setPrecioPorHora] = useState("");
  const [porcentajeImpuesto, setPorcentajeImpuesto] = useState("0");
  const [nombreCliente, setNombreCliente] = useState("");
  const [direccionCliente, setDireccionCliente] = useState("");
  const [nombreEmisor, setNombreEmisor] = useState("");
  const [identificacionEmisor, setIdentificacionEmisor] = useState("");
  const [direccionEmisor, setDireccionEmisor] = useState("");
  const [observaciones, setObservaciones] = useState("");

  const [guardando, setGuardando] = useState(false);
  const [recarga, setRecarga] = useState(0);

  const [editandoVisita, setEditandoVisita] = useState(null);
  const [nuevaDuracion, setNuevaDuracion] = useState("");

  const casaSeleccionada = useMemo(
    () => casas.find((casa) => String(casa.id) === String(casaId)) || null,
    [casas, casaId],
  );

  const cargarCasas = async (mesSel, anioSel) => {
    try {
      setCargandoCasas(true);
      const respuesta = await fetch(
        `${API_BASE}/casas/resumen-facturacion?mes=${mesSel}&anio=${anioSel}`,
      );
      const datos = await respuesta.json();
      if (!respuesta.ok || !datos.ok) {
        throw new Error(datos.error || "Error cargando casas");
      }
      setCasas(datos.casas || []);
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setCargandoCasas(false);
    }
  };

  const cargarVisitas = async (idCasa, mesSel, anioSel) => {
    try {
      setCargandoVisitas(true);
      const respuesta = await fetch(
        `${API_BASE}/casas/${idCasa}/visitas?mes=${mesSel}&anio=${anioSel}`,
      );
      const datos = await respuesta.json();
      if (!respuesta.ok || !datos.ok) {
        throw new Error(datos.error || "Error cargando visitas");
      }
      setVisitas(datos.visitas || []);
      setSeleccionadas([]);
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setCargandoVisitas(false);
    }
  };

  const cargarFacturas = async (idCasa) => {
    try {
      setCargandoFacturas(true);
      const respuesta = await fetch(`${API_BASE}/facturas?casa_id=${idCasa}`);
      const datos = await respuesta.json();
      if (!respuesta.ok || !datos.ok) {
        throw new Error(datos.error || "Error cargando facturas");
      }
      setFacturas(datos.facturas || []);
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setCargandoFacturas(false);
    }
  };

  useEffect(() => {
    Promise.resolve().then(() => {
      cargarCasas(mes, anio);
    });
  }, [mes, anio]);

  useEffect(() => {
    if (!casaId) {
      Promise.resolve().then(() => {
        setVisitas([]);
        setSeleccionadas([]);
        setEditandoVisita(null);
      });
      return;
    }

    Promise.resolve().then(() => {
      setError("");
      setAviso("");
      cargarVisitas(casaId, mes, anio);
    });
  }, [casaId, mes, anio, recarga]);

  useEffect(() => {
    if (!casaId) {
      Promise.resolve().then(() => {
        setFacturas([]);
      });
      return;
    }

    Promise.resolve().then(() => {
      cargarFacturas(casaId);
    });
  }, [casaId, recarga]);

  useEffect(() => {
    if (!casaSeleccionada) return;
    Promise.resolve().then(() => {
      setNombreCliente((previo) => previo || casaSeleccionada.nombre || "");
      setDireccionCliente((previo) => previo || casaSeleccionada.direccion || "");
    });
  }, [casaSeleccionada]);

  const cambiarCasa = (valor) => {
    if (!valor) {
      navigate("/facturas");
      return;
    }
    navigate(`/facturas/casas/${valor}`);
  };

  const toggleSeleccion = (id) => {
    setSeleccionadas((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const visitasSeleccionadas = useMemo(
    () => visitas.filter((visita) => seleccionadas.includes(visita.id)),
    [visitas, seleccionadas],
  );

  const totalMinutosSeleccionados = useMemo(
    () =>
      visitasSeleccionadas.reduce(
        (acumulado, visita) => acumulado + (visita.duracion_resuelta_minutos || 0),
        0,
      ),
    [visitasSeleccionadas],
  );

  const hayDuracionDesconocida = visitasSeleccionadas.some(
    (visita) => visita.duracion_resuelta_minutos == null,
  );

  const precioNumerico = Number(precioPorHora) || 0;
  const impuestoNumerico = Number(porcentajeImpuesto) || 0;

  const previsualizacion = useMemo(() => {
    const lineas = visitasSeleccionadas.map((visita) => {
      const minutos = visita.duracion_resuelta_minutos;
      return {
        ...visita,
        importe:
          minutos == null ? null : redondear2((minutos * precioNumerico) / 60),
      };
    });

    const baseImponible = redondear2(
      lineas.reduce((acumulado, linea) => acumulado + (linea.importe || 0), 0),
    );
    const importeImpuesto = redondear2((baseImponible * impuestoNumerico) / 100);

    return {
      lineas,
      baseImponible,
      importeImpuesto,
      total: redondear2(baseImponible + importeImpuesto),
    };
  }, [visitasSeleccionadas, precioNumerico, impuestoNumerico]);

  const crearBorrador = async () => {
    if (!casaSeleccionada) return;
    if (seleccionadas.length === 0) {
      setError("Selecciona al menos una visita.");
      return;
    }
    if (!precioPorHora) {
      setError("Introduce el precio por hora.");
      return;
    }
    if (!nombreCliente.trim()) {
      setError("El nombre del cliente es obligatorio.");
      return;
    }

    setGuardando(true);
    setError("");
    setAviso("");
    try {
      const fechaInicio = `${anio}-${String(mes).padStart(2, "0")}-01`;
      const ultimoDia = new Date(anio, mes, 0).getDate();
      const fechaFin = `${anio}-${String(mes).padStart(2, "0")}-${String(
        ultimoDia,
      ).padStart(2, "0")}`;

      const respuesta = await fetch(`${API_BASE}/facturas/borrador`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          casa_id: casaSeleccionada.id,
          fecha_inicio_periodo: fechaInicio,
          fecha_fin_periodo: fechaFin,
          precio_por_hora: precioNumerico,
          porcentaje_impuesto: impuestoNumerico,
          observaciones: observaciones || null,
          nombre_emisor: nombreEmisor || null,
          identificacion_emisor: identificacionEmisor || null,
          direccion_emisor: direccionEmisor || null,
          nombre_cliente: nombreCliente,
          direccion_cliente: direccionCliente || null,
          horario_ids: seleccionadas,
        }),
      });
      const datos = await respuesta.json();
      if (!respuesta.ok || !datos.ok) {
        throw new Error(datos.error || "Error creando borrador");
      }
      setAviso(
        `Borrador creado (id ${datos.factura_id}).${
          datos.pendiente_revision
            ? " Contiene visitas pendientes de duración; no podrá emitirse hasta resolverlas."
            : ""
        }`,
      );
      setSeleccionadas([]);
      setRecarga((valor) => valor + 1);
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  };

  const guardarDuracion = async (restablecer = false) => {
    if (!editandoVisita) return;

    let valor = null;

    if (!restablecer) {
      const numero = Number(nuevaDuracion);
      if (!Number.isInteger(numero) || numero <= 0) {
        setError("La duración debe ser un número entero de minutos mayor que cero.");
        return;
      }
      valor = numero;
    }

    const confirmado = window.confirm(
      restablecer
        ? "¿Restablecer la duración habitual de la casa para esta visita?"
        : `¿Guardar ${valor} minutos como duración facturable de esta visita?`,
    );
    if (!confirmado) return;

    try {
      setError("");
      const respuesta = await fetch(
        `${API_BASE}/horarios/${editandoVisita}/duracion-facturable`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ duracion_facturable_minutos: valor }),
        },
      );
      const datos = await respuesta.json();
      if (!respuesta.ok || !datos.ok) {
        throw new Error(datos.error || "Error guardando duración");
      }
      setEditandoVisita(null);
      setNuevaDuracion("");
      setAviso("Duración facturable actualizada.");
      setRecarga((contador) => contador + 1);
    } catch (err) {
      console.error(err);
      setError(err.message);
    }
  };

  const descargarPdf = (facturaId) => {
    window.open(`${API_BASE}/facturas/${facturaId}/pdf`, "_blank");
  };

  return (
    <div className="facturas-view">
      <section className="card">
        <div className="gestion-header">
          <div>
            <h2>Facturas</h2>
            <p>Casas, visitas facturables y facturas emitidas.</p>
          </div>
        </div>

        {error && <div className="error">{error}</div>}
        {aviso && <div className="aviso">{aviso}</div>}

        <div className="guardar-panel">
          <label htmlFor="selector-casa">Casa</label>
          <select
            id="selector-casa"
            value={casaId || ""}
            onChange={(event) => cambiarCasa(event.target.value)}
          >
            <option value="">-- Todas las casas --</option>
            {casas.map((casa) => (
              <option key={casa.id} value={casa.id}>
                {casa.nombre}
              </option>
            ))}
          </select>

          <label htmlFor="filtro-mes">Mes</label>
          <input
            id="filtro-mes"
            type="number"
            min="1"
            max="12"
            value={mes}
            onChange={(event) => setMes(Number(event.target.value))}
          />
          <label htmlFor="filtro-anio">Año</label>
          <input
            id="filtro-anio"
            type="number"
            value={anio}
            onChange={(event) => setAnio(Number(event.target.value))}
          />
        </div>
      </section>

      {!casaId && (
        <section className="card">
          <h2>Casas</h2>

          {cargandoCasas ? (
            <p className="gestion-vacio">Cargando casas...</p>
          ) : casas.length === 0 ? (
            <p className="gestion-vacio">No hay casas registradas.</p>
          ) : (
            <div className="tabla-responsive">
              <table className="tabla-datos">
                <thead>
                  <tr>
                    <th>Casa</th>
                    <th>Dirección</th>
                    <th>Duración habitual</th>
                    <th>Visitas del período</th>
                    <th>Horas facturables</th>
                    <th>Facturación</th>
                    <th>Estado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {casas.map((casa) => (
                    <tr key={casa.id}>
                      <td>
                        <Link className="btn-link" to={`/facturas/casas/${casa.id}`}>
                          {casa.nombre}
                        </Link>
                      </td>
                      <td>{casa.direccion || "-"}</td>
                      <td>
                        {casa.duracion_minutos
                          ? formatearMinutos(casa.duracion_minutos)
                          : "Desconocida"}
                      </td>
                      <td>
                        {casa.total_visitas || 0}
                        {Number(casa.visitas_pendientes) > 0 && (
                          <span className="mini-warning">
                            {" "}
                            ({casa.visitas_pendientes} sin duración)
                          </span>
                        )}
                      </td>
                      <td>{formatearMinutos(casa.total_facturable_minutos)}</td>
                      <td>
                        <span className="acciones-tabla">
                          {Number(casa.facturas_borrador) > 0 && (
                            <span className="estado-badge estado-borrador">
                              {casa.facturas_borrador} borrador
                            </span>
                          )}
                          {Number(casa.facturas_emitidas) > 0 && (
                            <span className="estado-badge estado-emitida">
                              {casa.facturas_emitidas} emitida
                            </span>
                          )}
                          {Number(casa.facturas_pagadas) > 0 && (
                            <span className="estado-badge estado-pagada">
                              {casa.facturas_pagadas} pagada
                            </span>
                          )}
                          {Number(casa.facturas_anuladas) > 0 && (
                            <span className="estado-badge estado-anulada">
                              {casa.facturas_anuladas} anulada
                            </span>
                          )}
                          {Number(casa.facturas_borrador) === 0 &&
                            Number(casa.facturas_emitidas) === 0 &&
                            Number(casa.facturas_pagadas) === 0 &&
                            Number(casa.facturas_anuladas) === 0 &&
                            "Sin facturas"}
                        </span>
                      </td>
                      <td>
                        <span
                          className={
                            casa.activo === true || casa.activo === 1
                              ? "estado-badge estado-pagada"
                              : "estado-badge estado-anulada"
                          }
                        >
                          {casa.activo === true || casa.activo === 1
                            ? "Activa"
                            : "Inactiva"}
                        </span>
                      </td>
                      <td>
                        <Link
                          className="btn-secondary btn-inline"
                          to={`/facturas/casas/${casa.id}`}
                        >
                          Ver perfil
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="tabla-scroll-hint">
                Desliza horizontalmente para ver todas las columnas.
              </p>
            </div>
          )}
        </section>
      )}

      {casaId && (
        <>
          <section className="card">
            <div className="gestion-header">
              <div>
                <h2>{casaSeleccionada?.nombre || `Casa ${casaId}`}</h2>
                <p>
                  Dirección: {casaSeleccionada?.direccion || "-"} · Duración
                  habitual:{" "}
                  {casaSeleccionada?.duracion_minutos
                    ? formatearMinutos(casaSeleccionada.duracion_minutos)
                    : "Desconocida"}
                </p>
              </div>
              <Link className="btn-secondary btn-inline" to="/facturas">
                Ver todas las casas
              </Link>
            </div>

            <h3>
              Visitas de {String(mes).padStart(2, "0")}/{anio}
            </h3>

            {cargandoVisitas ? (
              <p className="gestion-vacio">Cargando visitas...</p>
            ) : visitas.length === 0 ? (
              <p className="gestion-vacio">No hay visitas en este período.</p>
            ) : (
              <div className="tabla-responsive">
                <table className="tabla-datos">
                  <thead>
                    <tr>
                      <th>Sel.</th>
                      <th>Fecha</th>
                      <th>Horario</th>
                      <th>Trabajadores</th>
                      <th>Duración facturable</th>
                      <th>Origen</th>
                      <th>Facturada</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visitas.map((visita) => {
                      const origen =
                        visita.duracion_facturable_minutos != null
                          ? { texto: "Excepcional", clase: "origen-excepcional" }
                          : visita.duracion_habitual_minutos != null
                            ? { texto: "Habitual", clase: "origen-habitual" }
                            : { texto: "Desconocida", clase: "origen-desconocida" };

                      return (
                        <tr key={visita.id}>
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`Seleccionar visita del ${formatearFecha(visita.fecha)}`}
                              checked={seleccionadas.includes(visita.id)}
                              disabled={visita.facturada}
                              onChange={() => toggleSeleccion(visita.id)}
                            />
                          </td>
                          <td className="celda-fecha">{formatearFecha(visita.fecha)}</td>
                          <td className="celda-horario">
                            {String(visita.hora_inicio).slice(0, 5)} →{" "}
                            {String(visita.hora_fin).slice(0, 5)}
                          </td>
                          <td>
                            {visita.trabajadores.length === 0
                              ? "-"
                              : visita.trabajadores
                                  .map((t) => `${t.codigo} (${t.nombre})`)
                                  .join(", ")}
                          </td>
                          <td>
                            {visita.pendiente_revision ? (
                              <span className="mini-warning">
                                Pendiente de revisión
                              </span>
                            ) : (
                              formatearMinutos(visita.duracion_resuelta_minutos)
                            )}
                          </td>
                          <td>
                            <span className={`origen-badge ${origen.clase}`}>
                              {origen.texto}
                            </span>
                          </td>
                          <td>{visita.facturada ? "Sí" : "No"}</td>
                          <td>
                            <button
                              type="button"
                              className="btn-mini"
                              onClick={() => {
                                setEditandoVisita(visita.id);
                                setNuevaDuracion(
                                  visita.duracion_facturable_minutos != null
                                    ? visita.duracion_facturable_minutos
                                    : "",
                                );
                              }}
                            >
                              Editar duración
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="tabla-scroll-hint">
                  Desliza horizontalmente para ver todas las columnas.
                </p>
              </div>
            )}

            {editandoVisita && (
              <div className="guardar-panel panel-edicion">
                <label htmlFor="duracion-excepcional">
                  Duración facturable (min)
                </label>
                <input
                  id="duracion-excepcional"
                  type="number"
                  min="1"
                  value={nuevaDuracion}
                  onChange={(event) => setNuevaDuracion(event.target.value)}
                  placeholder="Vacío = duración habitual"
                />
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => guardarDuracion(false)}
                >
                  Guardar
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => guardarDuracion(true)}
                >
                  Restablecer habitual
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setEditandoVisita(null);
                    setNuevaDuracion("");
                  }}
                >
                  Cancelar
                </button>
              </div>
            )}

            <div className="resumen-seleccion">
              <span>
                <strong>Visitas seleccionadas:</strong> {visitasSeleccionadas.length}
              </span>
              <span>
                <strong>Total facturable:</strong>{" "}
                {formatearMinutos(totalMinutosSeleccionados)}
              </span>
              {hayDuracionDesconocida && (
                <span className="mini-warning">
                  Hay visitas seleccionadas con duración desconocida.
                </span>
              )}
            </div>
          </section>

          <section className="card">
            <h2>Crear factura</h2>
            <p>
              Los importes se recalculan en el servidor al guardar y al emitir.
              Esta vista previa es solo informativa.
            </p>

            <div className="form-grid">
              <div className="campo">
                <label htmlFor="precio-hora">Precio por hora (€)</label>
                <input
                  id="precio-hora"
                  type="number"
                  min="0"
                  step="0.01"
                  value={precioPorHora}
                  onChange={(event) => setPrecioPorHora(event.target.value)}
                />
              </div>
              <div className="campo">
                <label htmlFor="impuesto">Impuesto (%)</label>
                <input
                  id="impuesto"
                  type="number"
                  min="0"
                  step="0.01"
                  value={porcentajeImpuesto}
                  onChange={(event) => setPorcentajeImpuesto(event.target.value)}
                />
              </div>
            </div>

            <div className="form-grid">
              <div className="campo">
                <label htmlFor="cliente">Cliente</label>
                <input
                  id="cliente"
                  type="text"
                  value={nombreCliente}
                  onChange={(event) => setNombreCliente(event.target.value)}
                />
              </div>
              <div className="campo">
                <label htmlFor="direccion-cliente">Dirección cliente</label>
                <input
                  id="direccion-cliente"
                  type="text"
                  value={direccionCliente}
                  onChange={(event) => setDireccionCliente(event.target.value)}
                />
              </div>
            </div>

            <div className="form-grid">
              <div className="campo">
                <label htmlFor="emisor">Emisor</label>
                <input
                  id="emisor"
                  type="text"
                  value={nombreEmisor}
                  onChange={(event) => setNombreEmisor(event.target.value)}
                />
              </div>
              <div className="campo">
                <label htmlFor="identificacion">Identificación fiscal</label>
                <input
                  id="identificacion"
                  type="text"
                  value={identificacionEmisor}
                  onChange={(event) => setIdentificacionEmisor(event.target.value)}
                />
              </div>
              <div className="campo">
                <label htmlFor="direccion-emisor">Dirección emisor</label>
                <input
                  id="direccion-emisor"
                  type="text"
                  value={direccionEmisor}
                  onChange={(event) => setDireccionEmisor(event.target.value)}
                />
              </div>
            </div>

            <div className="form-grid">
              <div className="campo campo-ancho">
                <label htmlFor="observaciones">Observaciones</label>
                <input
                  id="observaciones"
                  type="text"
                  value={observaciones}
                  onChange={(event) => setObservaciones(event.target.value)}
                />
              </div>
            </div>

            {visitasSeleccionadas.length > 0 && (
              <div className="tabla-responsive">
                <table className="tabla-datos tabla-preview">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Horario</th>
                      <th>Duración</th>
                      <th>Precio/h</th>
                      <th>Importe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previsualizacion.lineas.map((linea) => (
                      <tr key={linea.id}>
                        <td className="celda-fecha">{formatearFecha(linea.fecha)}</td>
                        <td className="celda-horario">
                          {String(linea.hora_inicio).slice(0, 5)} →{" "}
                          {String(linea.hora_fin).slice(0, 5)}
                        </td>
                        <td>
                          {linea.duracion_resuelta_minutos == null
                            ? "Desconocida"
                            : formatearMinutos(linea.duracion_resuelta_minutos)}
                        </td>
                        <td>{precioNumerico.toFixed(2)} €</td>
                        <td>
                          {linea.importe == null
                            ? "-"
                            : `${linea.importe.toFixed(2)} €`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="tabla-scroll-hint">
                  Desliza horizontalmente para ver todas las columnas.
                </p>
              </div>
            )}

            <div className="totales-panel">
              <div>
                <span>Minutos facturables</span>
                <strong>{totalMinutosSeleccionados}</strong>
              </div>
              <div>
                <span>Horas facturables</span>
                <strong>{formatearMinutos(totalMinutosSeleccionados)}</strong>
              </div>
              <div>
                <span>Base imponible</span>
                <strong>{previsualizacion.baseImponible.toFixed(2)} €</strong>
              </div>
              <div>
                <span>Impuesto ({impuestoNumerico}%)</span>
                <strong>{previsualizacion.importeImpuesto.toFixed(2)} €</strong>
              </div>
              <div>
                <span>Total</span>
                <strong>{previsualizacion.total.toFixed(2)} €</strong>
              </div>
            </div>

            {hayDuracionDesconocida && (
              <div className="advertencia">
                Hay visitas seleccionadas con duración facturable desconocida.
                Puedes guardar el borrador, pero no podrá emitirse hasta que
                resuelvas su duración.
              </div>
            )}

            <button
              type="button"
              className="btn-primary"
              disabled={guardando}
              onClick={crearBorrador}
            >
              {guardando ? "Guardando..." : "Guardar borrador"}
            </button>
          </section>

          <section className="card">
            <h2>Facturas de esta casa</h2>
            {cargandoFacturas ? (
              <p className="gestion-vacio">Cargando facturas...</p>
            ) : facturas.length === 0 ? (
              <p className="gestion-vacio">No hay facturas para esta casa.</p>
            ) : (
              <div className="tabla-responsive">
                <table className="tabla-datos">
                  <thead>
                    <tr>
                      <th>Número</th>
                      <th>Período</th>
                      <th>Estado</th>
                      <th>Total</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {facturas.map((factura) => (
                      <tr key={factura.id}>
                        <td>
                          <Link className="btn-link" to={`/facturas/${factura.id}`}>
                            {factura.numero_factura || `Borrador #${factura.id}`}
                          </Link>
                        </td>
                        <td className="celda-fecha">
                          {formatearFecha(factura.fecha_inicio_periodo)} →{" "}
                          {formatearFecha(factura.fecha_fin_periodo)}
                        </td>
                        <td>
                          <span
                            className={`estado-badge estado-${factura.estado}`}
                          >
                            {etiquetaEstado[factura.estado] || factura.estado}
                          </span>
                        </td>
                        <td>{Number(factura.total).toFixed(2)} €</td>
                        <td>
                          <div className="acciones-tabla">
                            <Link
                              className="btn-secondary btn-inline"
                              to={`/facturas/${factura.id}`}
                            >
                              Ver detalle
                            </Link>
                            <button
                              type="button"
                              className="btn-secondary"
                              onClick={() => descargarPdf(factura.id)}
                            >
                              PDF
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="tabla-scroll-hint">
                  Desliza horizontalmente para ver todas las columnas.
                </p>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
