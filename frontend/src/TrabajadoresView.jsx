import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

const API_BASE = "http://localhost:3000/api";

const formatearMinutos = (minutos) => {
  const total = Number(minutos) || 0;
  const horas = Math.floor(total / 60);
  const resto = total % 60;
  if (horas === 0) {
    return `${resto} min`;
  }
  if (resto === 0) {
    return `${horas} h`;
  }
  return `${horas} h ${resto} min`;
};

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

const aISOlocal = (fechaObj) =>
  `${fechaObj.getFullYear()}-${String(fechaObj.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(fechaObj.getDate()).padStart(2, "0")}`;

const hoyISO = () => aISOlocal(new Date());

export default function TrabajadoresView() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [fecha, setFecha] = useState(hoyISO());
  const [resumen, setResumen] = useState([]);
  const [cargandoResumen, setCargandoResumen] = useState(false);
  const [error, setError] = useState("");

  const [perfil, setPerfil] = useState(null);
  const [cargandoPerfil, setCargandoPerfil] = useState(false);

  const fechaActual = new Date(fecha + "T00:00:00");
  const mesActual = fechaActual.getMonth() + 1;
  const anioActual = fechaActual.getFullYear();

  const [mes, setMes] = useState(mesActual);
  const [anio, setAnio] = useState(anioActual);

  const cargarResumen = async () => {
    try {
      setCargandoResumen(true);
      setError("");
      const respuesta = await fetch(
        `${API_BASE}/trabajadores/resumen-diario?fecha=${fecha}`,
      );
      const datos = await respuesta.json();
      if (!respuesta.ok || !datos.ok) {
        throw new Error(datos.error || "Error cargando resumen");
      }
      setResumen(datos.trabajadores || []);
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setCargandoResumen(false);
    }
  };

  const cargarPerfil = async (id, mesSel, anioSel) => {
    try {
      setCargandoPerfil(true);
      setError("");
      const respuesta = await fetch(
        `${API_BASE}/trabajadores/${id}/perfil?mes=${mesSel}&anio=${anioSel}`,
      );
      const datos = await respuesta.json();
      if (!respuesta.ok || !datos.ok) {
        throw new Error(datos.error || "Error cargando perfil");
      }
      setPerfil(datos);
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setCargandoPerfil(false);
    }
  };

  useEffect(() => {
    Promise.resolve().then(() => {
      cargarResumen();
    });
  }, [fecha]);

  useEffect(() => {
    if (!id) {
      Promise.resolve().then(() => {
        setPerfil(null);
      });
      return;
    }
    Promise.resolve().then(() => {
      cargarPerfil(id, mes, anio);
    });
  }, [id, mes, anio]);

  const cambiarDia = (desplazamiento) => {
    const nueva = new Date(fecha + "T00:00:00");
    nueva.setDate(nueva.getDate() + desplazamiento);
    setFecha(aISOlocal(nueva));
  };

  const totalGeneral = useMemo(() => {
    return resumen.reduce(
      (acc, item) => acc + (Number(item.minutos_trabajados) || 0),
      0,
    );
  }, [resumen]);

  return (
    <div className="trabajadores-view">
      <section className="card">
        <div className="gestion-header">
          <div>
            <h2>Trabajadores</h2>
            <p>Resumen de horas trabajadas por fecha.</p>
          </div>
        </div>

        <div className="guardar-panel">
          <label>Fecha</label>
          <button type="button" className="btn-secondary" onClick={() => cambiarDia(-1)}>
            ◀
          </button>
          <input
            type="date"
            value={fecha}
            onChange={(event) => setFecha(event.target.value)}
          />
          <button type="button" className="btn-secondary" onClick={() => cambiarDia(1)}>
            ▶
          </button>
        </div>

        {error && <div className="error">{error}</div>}

        {cargandoResumen ? (
          <p className="gestion-vacio">Cargando resumen...</p>
        ) : (
          <div className="tabla-responsive">
            <table className="tabla-datos">
              <thead>
                <tr>
                  <th>Trabajador</th>
                  <th>Código</th>
                  <th>Horas del día</th>
                </tr>
              </thead>
              <tbody>
                {resumen.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <Link className="btn-link" to={`/trabajadores/${item.id}`}>
                        {item.nombre}
                      </Link>
                    </td>
                    <td>{item.codigo}</td>
                    <td>{formatearMinutos(item.minutos_trabajados)}</td>
                  </tr>
                ))}
                <tr>
                  <td>
                    <strong>Total</strong>
                  </td>
                  <td />
                  <td>
                    <strong>{formatearMinutos(totalGeneral)}</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>

      {id && (
        <section className="card">
          <div className="gestion-header">
            <div>
              <h2>Perfil de {perfil?.trabajador?.nombre || "trabajador"}</h2>
              <p>Código: {perfil?.trabajador?.codigo || id}</p>
            </div>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => navigate("/trabajadores")}
            >
              Cerrar
            </button>
          </div>

          <div className="guardar-panel">
            <label>Mes</label>
            <input
              type="number"
              min="1"
              max="12"
              value={mes}
              onChange={(event) => setMes(Number(event.target.value))}
            />
            <label>Año</label>
            <input
              type="number"
              value={anio}
              onChange={(event) => setAnio(Number(event.target.value))}
            />
          </div>

          {cargandoPerfil ? (
            <p className="gestion-vacio">Cargando perfil...</p>
          ) : perfil ? (
            <>
              <div className="datos-referencia">
                <div className="dato-box">
                  <span>Horas del período</span>
                  <strong>{formatearMinutos(perfil.total_minutos)}</strong>
                </div>
                <div className="dato-box">
                  <span>Servicios</span>
                  <strong>{perfil.total_servicios}</strong>
                </div>
                <div className="dato-box">
                  <span>Casas distintas</span>
                  <strong>{perfil.casas_distintas}</strong>
                </div>
              </div>

              <div className="tabla-responsive">
                <table className="tabla-datos">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Casa</th>
                      <th>Horario</th>
                      <th>Duración</th>
                      <th>Otros trabajadores</th>
                    </tr>
                  </thead>
                  <tbody>
                    {perfil.servicios.map((servicio) => (
                      <tr key={servicio.id}>
                        <td className="celda-fecha">
                          {formatearFecha(servicio.fecha)}
                        </td>
                        <td>{servicio.casa}</td>
                        <td className="celda-horario">
                          {String(servicio.hora_inicio).slice(0, 5)} →{" "}
                          {String(servicio.hora_fin).slice(0, 5)}
                        </td>
                        <td>{formatearMinutos(servicio.duracion_minutos)}</td>
                        <td>
                          {servicio.otros_trabajadores
                            .map((t) => t.codigo)
                            .join(", ") || "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </section>
      )}
    </div>
  );
}
