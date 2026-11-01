import { useEffect, useState } from "react";
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
  if (!fecha) return "-";
  return new Date(fecha).toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
};

const etiquetaEstado = {
  borrador: "Borrador",
  emitida: "Emitida",
  pagada: "Pagada",
  anulada: "Anulada",
};

const redondear2 = (valor) => Math.round((Number(valor) || 0) * 100) / 100;

export default function FacturaDetalleView() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [factura, setFactura] = useState(null);
  const [detalles, setDetalles] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [procesando, setProcesando] = useState(false);

  const [editando, setEditando] = useState(false);
  const [form, setForm] = useState(null);
  const [visitasCasa, setVisitasCasa] = useState([]);
  const [seleccionVisitas, setSeleccionVisitas] = useState([]);
  const [cargandoVisitas, setCargandoVisitas] = useState(false);

  const cargarFactura = async () => {
    try {
      setCargando(true);
      setError("");
      const respuesta = await fetch(`${API_BASE}/facturas/${id}`);
      const datos = await respuesta.json();
      if (!respuesta.ok || !datos.ok) {
        throw new Error(datos.error || "Error cargando la factura");
      }
      setFactura(datos.factura);
      setDetalles(datos.detalles || []);
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    Promise.resolve().then(() => {
      cargarFactura();
    });
  }, [id]);

  const empezarEdicion = async () => {
    if (!factura) return;

    setForm({
      nombre_cliente: factura.nombre_cliente || "",
      direccion_cliente: factura.direccion_cliente || "",
      nombre_emisor: factura.nombre_emisor || "",
      identificacion_emisor: factura.identificacion_emisor || "",
      direccion_emisor: factura.direccion_emisor || "",
      precio_por_hora: String(factura.precio_por_hora ?? ""),
      porcentaje_impuesto: String(factura.porcentaje_impuesto ?? "0"),
      observaciones: factura.observaciones || "",
    });

    setSeleccionVisitas(
      detalles.map((detalle) => detalle.horario_id).filter(Boolean),
    );
    setEditando(true);
    setAviso("");
    setError("");

    try {
      setCargandoVisitas(true);
      const desde = String(factura.fecha_inicio_periodo).slice(0, 10);
      const hasta = String(factura.fecha_fin_periodo).slice(0, 10);
      const respuesta = await fetch(
        `${API_BASE}/casas/${factura.casa_id}/visitas?desde=${desde}&hasta=${hasta}`,
      );
      const datos = await respuesta.json();
      if (!respuesta.ok || !datos.ok) {
        throw new Error(datos.error || "Error cargando visitas del período");
      }
      setVisitasCasa(datos.visitas || []);
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setCargandoVisitas(false);
    }
  };

  const toggleVisita = (horarioId) => {
    setSeleccionVisitas((prev) =>
      prev.includes(horarioId)
        ? prev.filter((valor) => valor !== horarioId)
        : [...prev, horarioId],
    );
  };

  const guardarBorrador = async () => {
    if (!form) return;
    if (seleccionVisitas.length === 0) {
      setError("Selecciona al menos una visita para el borrador.");
      return;
    }
    if (!form.nombre_cliente.trim()) {
      setError("El nombre del cliente es obligatorio.");
      return;
    }

    setProcesando(true);
    setError("");
    setAviso("");
    try {
      const respuesta = await fetch(`${API_BASE}/facturas/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre_cliente: form.nombre_cliente,
          direccion_cliente: form.direccion_cliente || null,
          nombre_emisor: form.nombre_emisor || null,
          identificacion_emisor: form.identificacion_emisor || null,
          direccion_emisor: form.direccion_emisor || null,
          precio_por_hora: Number(form.precio_por_hora),
          porcentaje_impuesto: Number(form.porcentaje_impuesto || 0),
          observaciones: form.observaciones || null,
          horario_ids: seleccionVisitas,
        }),
      });
      const datos = await respuesta.json();
      if (!respuesta.ok || !datos.ok) {
        throw new Error(datos.error || "Error guardando el borrador");
      }
      setEditando(false);
      setAviso("Borrador actualizado.");
      await cargarFactura();
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setProcesando(false);
    }
  };

  const emitir = async () => {
    const faltan = [];
    if (!factura.nombre_emisor) faltan.push("nombre del emisor");
    if (!factura.identificacion_emisor) faltan.push("identificación fiscal del emisor");
    if (!factura.direccion_emisor) faltan.push("dirección del emisor");
    if (!factura.nombre_cliente) faltan.push("nombre del cliente");

    const avisoFiscal =
      faltan.length > 0
        ? `\n\nAviso: faltan datos (${faltan.join(", ")}). La factura no puede considerarse legalmente completa.`
        : "";

    if (!window.confirm(`¿Emitir esta factura definitivamente?${avisoFiscal}`)) {
      return;
    }

    setProcesando(true);
    setError("");
    setAviso("");
    try {
      const respuesta = await fetch(`${API_BASE}/facturas/${id}/emitir`, {
        method: "POST",
      });
      const datos = await respuesta.json();
      if (!respuesta.ok || !datos.ok) {
        throw new Error(datos.error || "Error emitiendo la factura");
      }
      setAviso(`Factura emitida con número ${datos.numero_factura}.`);
      await cargarFactura();
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setProcesando(false);
    }
  };

  const cambiarEstado = async (estado) => {
    if (
      !window.confirm(
        `¿Cambiar el estado de la factura a "${etiquetaEstado[estado]}"? Esta acción no genera una factura rectificativa.`,
      )
    ) {
      return;
    }

    setProcesando(true);
    setError("");
    setAviso("");
    try {
      const respuesta = await fetch(`${API_BASE}/facturas/${id}/estado`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado }),
      });
      const datos = await respuesta.json();
      if (!respuesta.ok || !datos.ok) {
        throw new Error(datos.error || "Error cambiando el estado");
      }
      setAviso(`Estado actualizado a ${etiquetaEstado[estado]}.`);
      await cargarFactura();
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setProcesando(false);
    }
  };

  const eliminarBorrador = async () => {
    if (
      !window.confirm(
        "¿Eliminar este borrador? Se borrarán también sus líneas. Esta acción no se puede deshacer.",
      )
    ) {
      return;
    }

    setProcesando(true);
    setError("");
    try {
      const respuesta = await fetch(`${API_BASE}/facturas/${id}`, {
        method: "DELETE",
      });
      const datos = await respuesta.json();
      if (!respuesta.ok || !datos.ok) {
        throw new Error(datos.error || "Error eliminando el borrador");
      }
      navigate(`/facturas/casas/${factura.casa_id}`);
    } catch (err) {
      console.error(err);
      setError(err.message);
      setProcesando(false);
    }
  };

  const descargarPdf = () => {
    window.open(`${API_BASE}/facturas/${id}/pdf`, "_blank", "noopener");
  };

  if (cargando) {
    return <p className="gestion-vacio">Cargando factura...</p>;
  }

  if (!factura) {
    return (
      <div className="card">
        <div className="error">{error || "Factura no encontrada"}</div>
        <Link className="btn-secondary btn-inline" to="/facturas">
          Volver a facturas
        </Link>
      </div>
    );
  }

  const tieneDuracionDesconocida = detalles.some(
    (detalle) => !detalle.duracion_facturable_minutos,
  );
  const esBorrador = factura.estado === "borrador";

  return (
    <div className="factura-detalle-view">
      <div className="detalle-acciones-superiores">
        <Link
          className="btn-secondary btn-inline"
          to={`/facturas/casas/${factura.casa_id}`}
        >
          ← Volver a la casa
        </Link>
        <span className={`estado-badge estado-${factura.estado}`}>
          {etiquetaEstado[factura.estado] || factura.estado}
        </span>
      </div>

      {error && <div className="error">{error}</div>}
      {aviso && <div className="aviso">{aviso}</div>}

      <section className="card">
        <div className="gestion-header">
          <div>
            <h2>
              {factura.numero_factura || `Borrador #${factura.id}`}
            </h2>
            <p>
              {detalles[0]?.nombre_casa || factura.casa_nombre} · Período{" "}
              {formatearFecha(factura.fecha_inicio_periodo)} a{" "}
              {formatearFecha(factura.fecha_fin_periodo)}
            </p>
          </div>
          <div className="acciones-tabla">
            <button
              type="button"
              className="btn-secondary"
              onClick={descargarPdf}
            >
              Descargar PDF
            </button>
            {esBorrador && !editando && (
              <>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={empezarEdicion}
                  disabled={procesando}
                >
                  Editar borrador
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={emitir}
                  disabled={procesando}
                >
                  Emitir factura
                </button>
                <button
                  type="button"
                  className="btn-peligro"
                  onClick={eliminarBorrador}
                  disabled={procesando}
                >
                  Eliminar
                </button>
              </>
            )}
            {factura.estado === "emitida" && (
              <>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => cambiarEstado("pagada")}
                  disabled={procesando}
                >
                  Marcar pagada
                </button>
                <button
                  type="button"
                  className="btn-peligro"
                  onClick={() => cambiarEstado("anulada")}
                  disabled={procesando}
                >
                  Anular
                </button>
              </>
            )}
            {factura.estado === "pagada" && (
              <button
                type="button"
                className="btn-peligro"
                onClick={() => cambiarEstado("anulada")}
                disabled={procesando}
              >
                Anular
              </button>
            )}
          </div>
        </div>

        {esBorrador && tieneDuracionDesconocida && (
          <div className="advertencia">
            Este borrador contiene visitas con duración desconocida. Resuelve su
            duración en el perfil de la casa antes de emitirlo.
          </div>
        )}

        {esBorrador &&
          (!factura.nombre_emisor || !factura.identificacion_emisor) && (
            <div className="advertencia">
              Faltan datos fiscales del emisor. La factura puede guardarse como
              borrador, pero no debe considerarse legalmente completa.
            </div>
          )}

        <div className="detalle-grid">
          <div>
            <h3>Emisor</h3>
            <p>{factura.nombre_emisor || "Sin configurar"}</p>
            <p>{factura.identificacion_emisor || "Sin identificación fiscal"}</p>
            <p>{factura.direccion_emisor || "Sin dirección"}</p>
          </div>
          <div>
            <h3>Cliente</h3>
            <p>{factura.nombre_cliente}</p>
            <p>{factura.direccion_cliente || "Sin dirección"}</p>
          </div>
          <div>
            <h3>Fechas</h3>
            <p>Emisión: {formatearFecha(factura.fecha_emision)}</p>
            <p>Creada: {formatearFecha(factura.fecha_creacion)}</p>
          </div>
        </div>

        {editando && form ? (
          <div className="edicion-borrador">
            <h3>Editar borrador</h3>

            <div className="form-grid">
              <div className="campo">
                <label htmlFor="edit-cliente">Cliente</label>
                <input
                  id="edit-cliente"
                  type="text"
                  value={form.nombre_cliente}
                  onChange={(event) =>
                    setForm({ ...form, nombre_cliente: event.target.value })
                  }
                />
              </div>
              <div className="campo">
                <label htmlFor="edit-direccion-cliente">Dirección cliente</label>
                <input
                  id="edit-direccion-cliente"
                  type="text"
                  value={form.direccion_cliente}
                  onChange={(event) =>
                    setForm({ ...form, direccion_cliente: event.target.value })
                  }
                />
              </div>
            </div>

            <div className="form-grid">
              <div className="campo">
                <label htmlFor="edit-emisor">Emisor</label>
                <input
                  id="edit-emisor"
                  type="text"
                  value={form.nombre_emisor}
                  onChange={(event) =>
                    setForm({ ...form, nombre_emisor: event.target.value })
                  }
                />
              </div>
              <div className="campo">
                <label htmlFor="edit-identificacion">Identificación fiscal</label>
                <input
                  id="edit-identificacion"
                  type="text"
                  value={form.identificacion_emisor}
                  onChange={(event) =>
                    setForm({ ...form, identificacion_emisor: event.target.value })
                  }
                />
              </div>
              <div className="campo">
                <label htmlFor="edit-direccion-emisor">Dirección emisor</label>
                <input
                  id="edit-direccion-emisor"
                  type="text"
                  value={form.direccion_emisor}
                  onChange={(event) =>
                    setForm({ ...form, direccion_emisor: event.target.value })
                  }
                />
              </div>
            </div>

            <div className="form-grid">
              <div className="campo">
                <label htmlFor="edit-precio">Precio por hora (€)</label>
                <input
                  id="edit-precio"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.precio_por_hora}
                  onChange={(event) =>
                    setForm({ ...form, precio_por_hora: event.target.value })
                  }
                />
              </div>
              <div className="campo">
                <label htmlFor="edit-impuesto">Impuesto (%)</label>
                <input
                  id="edit-impuesto"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.porcentaje_impuesto}
                  onChange={(event) =>
                    setForm({ ...form, porcentaje_impuesto: event.target.value })
                  }
                />
              </div>
            </div>

            <div className="form-grid">
              <div className="campo campo-ancho">
                <label htmlFor="edit-observaciones">Observaciones</label>
                <input
                  id="edit-observaciones"
                  type="text"
                  value={form.observaciones}
                  onChange={(event) =>
                    setForm({ ...form, observaciones: event.target.value })
                  }
                />
              </div>
            </div>

            <h3>Visitas incluidas</h3>
            {cargandoVisitas ? (
              <p className="gestion-vacio">Cargando visitas...</p>
            ) : (
              <div className="tabla-responsive">
                <table className="tabla-datos">
                  <thead>
                    <tr>
                      <th>Sel.</th>
                      <th>Fecha</th>
                      <th>Horario</th>
                      <th>Duración facturable</th>
                      <th>Facturada</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visitasCasa.map((visita) => (
                      <tr key={visita.id}>
                        <td>
                          <input
                            type="checkbox"
                            checked={seleccionVisitas.includes(visita.id)}
                            disabled={visita.facturada}
                            onChange={() => toggleVisita(visita.id)}
                            aria-label={`Seleccionar visita del ${formatearFecha(
                              visita.fecha,
                            )}`}
                          />
                        </td>
                        <td className="celda-fecha">{formatearFecha(visita.fecha)}</td>
                        <td className="celda-horario">
                          {String(visita.hora_inicio).slice(0, 5)} →{" "}
                          {String(visita.hora_fin).slice(0, 5)}
                        </td>
                        <td>
                          {visita.pendiente_revision
                            ? "Desconocida"
                            : formatearMinutos(visita.duracion_resuelta_minutos)}
                        </td>
                        <td>{visita.facturada ? "Sí" : "No"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="tabla-scroll-hint">
                  Desliza horizontalmente para ver todas las columnas.
                </p>
              </div>
            )}

            <p className="nota">
              Previsualización calculada en el navegador. Al guardar, el servidor
              recalcula las líneas y los importes.
            </p>

            <div className="acciones-tabla">
              <button
                type="button"
                className="btn-primary"
                onClick={guardarBorrador}
                disabled={procesando}
              >
                {procesando ? "Guardando..." : "Guardar cambios"}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setEditando(false);
                  setForm(null);
                  setError("");
                }}
                disabled={procesando}
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <>
            <h3>Líneas de la factura</h3>
            {detalles.length === 0 ? (
              <p className="gestion-vacio">La factura no tiene líneas.</p>
            ) : (
              <div className="tabla-responsive">
                <table className="tabla-datos">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Descripción</th>
                      <th>Horario</th>
                      <th>Minutos</th>
                      <th>Horas</th>
                      <th>Precio/h</th>
                      <th>Importe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detalles.map((detalle) => (
                      <tr key={detalle.id}>
                        <td className="celda-fecha">
                          {formatearFecha(detalle.fecha_servicio)}
                        </td>
                        <td>{detalle.descripcion}</td>
                        <td className="celda-horario">
                          {String(detalle.hora_inicio || "").slice(0, 5)} →{" "}
                          {String(detalle.hora_fin || "").slice(0, 5)}
                        </td>
                        <td>{detalle.duracion_facturable_minutos}</td>
                        <td>
                          {formatearMinutos(detalle.duracion_facturable_minutos)}
                        </td>
                        <td>{Number(detalle.precio_por_hora).toFixed(2)} €</td>
                        <td>{Number(detalle.importe).toFixed(2)} €</td>
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
                <strong>{factura.horas_totales_minutos}</strong>
              </div>
              <div>
                <span>Horas facturables</span>
                <strong>
                  {redondear2(factura.horas_totales_minutos / 60).toFixed(2)} h
                </strong>
              </div>
              <div>
                <span>Precio por hora</span>
                <strong>{Number(factura.precio_por_hora).toFixed(2)} €</strong>
              </div>
              <div>
                <span>Base imponible</span>
                <strong>{Number(factura.base_imponible).toFixed(2)} €</strong>
              </div>
              <div>
                <span>Impuesto ({Number(factura.porcentaje_impuesto)}%)</span>
                <strong>{Number(factura.importe_impuesto).toFixed(2)} €</strong>
              </div>
              <div>
                <span>Total</span>
                <strong>{Number(factura.total).toFixed(2)} €</strong>
              </div>
            </div>

            {factura.observaciones && (
              <p className="nota">Observaciones: {factura.observaciones}</p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
