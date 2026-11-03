import { useEffect, useMemo, useState } from "react";
import {
  Link,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import TrabajadoresView from "./TrabajadoresView";
import FacturasView from "./FacturasView";
import FacturaDetalleView from "./FacturaDetalleView";
import "./App.css";

const API_BASE = "http://localhost:3000/api";

const normalizarActivo = (valor) => valor === true || valor === 1;

const MINUTOS_POR_HORA = 60;

// Convierte minutos (valor almacenado en MySQL) a un texto editable en horas.
const minutosAHorasInput = (minutos) => {
  if (minutos === null || minutos === undefined || minutos === "") {
    return "";
  }

  const total = Number(minutos);

  if (!Number.isFinite(total) || total <= 0) {
    return "";
  }

  const horas = Math.round((total / MINUTOS_POR_HORA) * 100) / 100;

  return Number.isInteger(horas)
    ? String(horas)
    : horas.toFixed(2).replace(/0+$/, "").replace(/\.$/, "").replace(".", ",");
};

// Convierte horas escritas por el usuario (coma o punto) a minutos enteros.
// Devuelve { minutos: null } si el campo está vacío y { error } si no es válido.
const parsearHorasAMinutos = (texto) => {
  const limpio = String(texto ?? "").trim().replace(",", ".");

  if (!limpio) {
    return { minutos: null };
  }

  if (!/^\d+(?:\.\d+)?$/.test(limpio)) {
    return {
      error:
        "Introduce una duración válida en horas (por ejemplo: 4 o 1,5).",
    };
  }

  const horas = Number(limpio);

  if (!Number.isFinite(horas) || horas <= 0) {
    return {
      error: "La duración habitual debe ser mayor que cero.",
    };
  }

  const minutos = Math.round(horas * MINUTOS_POR_HORA);

  if (minutos <= 0) {
    return {
      error: "La duración habitual debe ser mayor que cero.",
    };
  }

  return { minutos };
};

// Texto que se muestra en el listado de casas, siempre en horas.
const formatearDuracionHoras = (minutos) => {
  if (minutos === null || minutos === undefined || minutos === "") {
    return "Sin duración";
  }

  const total = Number(minutos);

  if (!Number.isFinite(total) || total <= 0) {
    return "Sin duración";
  }

  // Duraciones inferiores a una hora se muestran en minutos para no perder claridad.
  if (total < MINUTOS_POR_HORA) {
    return `${Math.round(total)} min`;
  }

  return `${minutosAHorasInput(total)} h`;
};

// Duración trabajada en formato legible (horas y minutos).
const formatearMinutosTrabajados = (minutos) => {
  const total = Number(minutos) || 0;

  if (total <= 0) {
    return "0 min";
  }

  const horas = Math.floor(total / MINUTOS_POR_HORA);
  const resto = total % MINUTOS_POR_HORA;

  if (horas === 0) {
    return `${resto} min`;
  }

  if (resto === 0) {
    return `${horas} h`;
  }

  return `${horas} h ${resto} min`;
};

// Tipos de punto de servicio admitidos por el backend.
const TIPOS_SERVICIO = [
  { valor: "vivienda", etiqueta: "Vivienda" },
  { valor: "escalera", etiqueta: "Escalera" },
  { valor: "empresa", etiqueta: "Empresa" },
  { valor: "piscina", etiqueta: "Piscina" },
  { valor: "local", etiqueta: "Local" },
  { valor: "otro", etiqueta: "Otro" },
];

const CASA_FORM_VACIA = {
  nombre: "",
  nombre_cliente: "",
  apellidos_cliente: "",
  direccion: "",
  contacto: "",
  codigo_postal: "",
  poblacion: "",
  tipo: "",
  frecuencia_texto: "",
  visitas_por_periodo: "",
  periodo_dias: "",
  precio_hora: "",
  duracion_minutos: "",
  emite_factura: false,
  observaciones: "",
};

const TRABAJADOR_FORM_VACIO = {
  nombre: "",
  apellidos: "",
  codigo: "",
  contacto: "",
  direccion: "",
  poblacion: "",
};

const nombreCompletoTrabajador = (trabajador) =>
  [trabajador.nombre, trabajador.apellidos].filter(Boolean).join(" ");

// Convierte una casa de la API al formulario editable (duración en horas).
const casaAFormulario = (casa) => {
  const formulario = { ...CASA_FORM_VACIA };

  for (const campo of Object.keys(CASA_FORM_VACIA)) {
    if (casa[campo] !== null && casa[campo] !== undefined) {
      formulario[campo] = casa[campo];
    }
  }

  formulario.duracion_minutos = minutosAHorasInput(casa.duracion_minutos);
  formulario.emite_factura = normalizarActivo(casa.emite_factura);

  return formulario;
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

// Lunes de la semana a la que pertenece una fecha (YYYY-MM-DD).
const obtenerLunes = (fechaISO) => {
  const fecha = new Date(`${fechaISO}T00:00:00`);
  const diaSemana = fecha.getDay();
  const desplazamiento = diaSemana === 0 ? -6 : 1 - diaSemana;

  fecha.setDate(fecha.getDate() + desplazamiento);

  return aISOlocal(fecha);
};

// Rango de fechas (desde/hasta) para el perfil de un trabajador.
const rangoPeriodoPerfil = (periodo, fechaISO, mesISO) => {
  if (periodo === "dia") {
    return { desde: fechaISO, hasta: fechaISO };
  }

  if (periodo === "semana") {
    const desde = obtenerLunes(fechaISO);
    const hastaObj = new Date(`${desde}T00:00:00`);

    hastaObj.setDate(hastaObj.getDate() + 6);

    return { desde, hasta: aISOlocal(hastaObj) };
  }

  const [anio, mes] = mesISO.split("-").map(Number);
  const ultimoDia = new Date(anio, mes, 0).getDate();

  return {
    desde: `${mesISO}-01`,
    hasta: `${mesISO}-${String(ultimoDia).padStart(2, "0")}`,
  };
};

const ETIQUETAS_PERIODO = {
  dia: "Día",
  semana: "Semana",
  mes: "Mes",
};

const ETIQUETAS_HORAS_PERIODO = {
  dia: "Horas del día",
  semana: "Horas de la semana",
  mes: "Horas del mes",
};

const formatearHora = (hora) => {
  if (!hora) {
    return "--:--";
  }

  return String(hora).slice(0, 5);
};

function HorariosView() {
  const location = useLocation();

  // La sección se deduce de la URL. Al mantener esta vista montada para las
  // tres rutas, el estado del análisis y de la revisión no se pierde al
  // navegar entre Horarios, Gestión e Historial.
  const seccion =
    location.pathname === "/gestion"
      ? "gestion"
      : location.pathname === "/historial"
        ? "historial"
        : "horarios";

  const [imagen, setImagen] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [error, setError] = useState("");

  // Pestaña activa de la sección de horarios: "analizar" o "revisar".
  // Es solo estado de interfaz: cambiar de pestaña no vuelve a llamar a Gemini.
  const [pestanaHorario, setPestanaHorario] = useState("analizar");

  const [casas, setCasas] = useState([]);
  const [trabajadores, setTrabajadores] = useState([]);
  const [cargandoDatos, setCargandoDatos] = useState(true);

  const [editandoIndex, setEditandoIndex] = useState(null);

  // Índice del servicio cuya casa se está creando desde la revisión.
  const [casaCreandoIndex, setCasaCreandoIndex] = useState(null);

  const [fecha, setFecha] = useState(new Date().toISOString().split("T")[0]);

  const [guardando, setGuardando] = useState(false);

  // =========================================
  // GESTIÓN DE CASAS Y TRABAJADORES
  // =========================================

  // Pestaña secundaria de Gestión: "casas" o "trabajadores".
  const [pestanaGestion, setPestanaGestion] = useState("casas");

  const [nuevoTrabajador, setNuevoTrabajador] = useState({
    ...TRABAJADOR_FORM_VACIO,
  });

  const [nuevaCasa, setNuevaCasa] = useState({ ...CASA_FORM_VACIA });

  const [trabajadorEditando, setTrabajadorEditando] = useState(null);
  const [casaEditando, setCasaEditando] = useState(null);

  const [guardandoTrabajador, setGuardandoTrabajador] = useState(false);
  const [guardandoCasa, setGuardandoCasa] = useState(false);
  const [errorDuracionCasa, setErrorDuracionCasa] = useState("");

  const [busquedaCasa, setBusquedaCasa] = useState("");
  const [soloPendientes, setSoloPendientes] = useState(false);
  const [busquedaTrabajador, setBusquedaTrabajador] = useState("");

  // Resumen de horas trabajadas por fecha (se muestra en Gestión > Trabajadores).
  const [fechaResumen, setFechaResumen] = useState(aISOlocal(new Date()));
  const [resumenTrabajadores, setResumenTrabajadores] = useState([]);
  const [cargandoResumen, setCargandoResumen] = useState(false);
  const [errorResumen, setErrorResumen] = useState("");

  // Perfil de trabajador: se abre al pulsar sobre un trabajador.
  const [trabajadorPerfil, setTrabajadorPerfil] = useState(null);
  const [periodoPerfil, setPeriodoPerfil] = useState("dia");
  const [fechaPerfil, setFechaPerfil] = useState(aISOlocal(new Date()));
  const [mesPerfil, setMesPerfil] = useState(
    aISOlocal(new Date()).slice(0, 7),
  );
  const [perfilTrabajador, setPerfilTrabajador] = useState(null);
  const [cargandoPerfil, setCargandoPerfil] = useState(false);
  const [errorPerfil, setErrorPerfil] = useState("");

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

  const casasFiltradas = useMemo(() => {
    const termino = busquedaCasa.trim().toLowerCase();

    return casas.filter((casa) => {
      if (soloPendientes && !normalizarActivo(casa.datos_pendientes)) {
        return false;
      }

      if (!termino) {
        return true;
      }

      return [
        casa.nombre,
        casa.nombre_cliente,
        casa.apellidos_cliente,
        casa.direccion,
        casa.poblacion,
      ]
        .filter(Boolean)
        .some((valor) => String(valor).toLowerCase().includes(termino));
    });
  }, [casas, busquedaCasa, soloPendientes]);

  const casasPendientes = useMemo(
    () => casas.filter((casa) => normalizarActivo(casa.datos_pendientes)).length,
    [casas],
  );

  const trabajadoresFiltrados = useMemo(() => {
    const termino = busquedaTrabajador.trim().toLowerCase();

    if (!termino) {
      return trabajadores;
    }

    return trabajadores.filter((trabajador) =>
      [trabajador.nombre, trabajador.apellidos, trabajador.codigo]
        .filter(Boolean)
        .some((valor) => String(valor).toLowerCase().includes(termino)),
    );
  }, [trabajadores, busquedaTrabajador]);

  const trabajadoresPendientes = useMemo(
    () =>
      trabajadores.filter((trabajador) =>
        normalizarActivo(trabajador.datos_pendientes),
      ).length,
    [trabajadores],
  );

  const totalMinutosResumen = useMemo(
    () =>
      resumenTrabajadores.reduce(
        (total, trabajador) =>
          total + (Number(trabajador.minutos_trabajados) || 0),
        0,
      ),
    [resumenTrabajadores],
  );

  const rangoPerfilActual = useMemo(
    () => rangoPeriodoPerfil(periodoPerfil, fechaPerfil, mesPerfil),
    [periodoPerfil, fechaPerfil, mesPerfil],
  );

  const casasPerfil = useMemo(() => {
    if (!perfilTrabajador) {
      return [];
    }

    const casasUnicas = new Map();

    for (const servicio of perfilTrabajador.servicios) {
      casasUnicas.set(servicio.casa_id, servicio.casa);
    }

    return [...casasUnicas.values()];
  }, [perfilTrabajador]);

  // URL temporal para la vista previa de la imagen seleccionada. Se libera
  // cuando cambia la imagen o se desmonta la vista para no acumular memoria.
  const vistaPrevia = useMemo(
    () => (imagen ? URL.createObjectURL(imagen) : ""),
    [imagen],
  );

  useEffect(() => {
    if (!vistaPrevia) {
      return undefined;
    }

    return () => URL.revokeObjectURL(vistaPrevia);
  }, [vistaPrevia]);

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

  useEffect(() => {
    let activo = true;

    const cargarResumen = async () => {
      try {
        setCargandoResumen(true);
        setErrorResumen("");

        const respuesta = await fetch(
          `${API_BASE}/trabajadores/resumen-diario?fecha=${fechaResumen}`,
        );
        const datos = await respuesta.json();

        if (!activo) {
          return;
        }

        if (!respuesta.ok || !datos.ok) {
          throw new Error(datos.error || "Error cargando el resumen de horas");
        }

        setResumenTrabajadores(datos.trabajadores || []);
      } catch (error) {
        if (!activo) {
          return;
        }

        console.error(error);
        setErrorResumen(error.message);
        setResumenTrabajadores([]);
      } finally {
        if (activo) {
          setCargandoResumen(false);
        }
      }
    };

    Promise.resolve().then(cargarResumen);

    return () => {
      activo = false;
    };
  }, [fechaResumen]);

  const cambiarFechaResumen = (desplazamiento) => {
    const nueva = new Date(`${fechaResumen}T00:00:00`);
    nueva.setDate(nueva.getDate() + desplazamiento);
    setFechaResumen(aISOlocal(nueva));
  };

  // =========================================
  // PERFIL DE TRABAJADOR
  // =========================================

  const abrirPerfilTrabajador = (trabajador) => {
    const hoy = new Date();

    setTrabajadorPerfil(trabajador);
    setPeriodoPerfil("dia");
    setFechaPerfil(aISOlocal(hoy));
    setMesPerfil(aISOlocal(hoy).slice(0, 7));
    setPerfilTrabajador(null);
    setErrorPerfil("");
  };

  const cerrarPerfilTrabajador = () => {
    setTrabajadorPerfil(null);
    setPerfilTrabajador(null);
    setErrorPerfil("");
  };

  useEffect(() => {
    if (!trabajadorPerfil) {
      return undefined;
    }

    let activo = true;

    const { desde, hasta } = rangoPeriodoPerfil(
      periodoPerfil,
      fechaPerfil,
      mesPerfil,
    );

    const cargarPerfil = async () => {
      try {
        setCargandoPerfil(true);
        setErrorPerfil("");

        const respuesta = await fetch(
          `${API_BASE}/trabajadores/${trabajadorPerfil.id}/perfil?desde=${desde}&hasta=${hasta}`,
        );
        const datos = await respuesta.json();

        if (!activo) {
          return;
        }

        if (!respuesta.ok || !datos.ok) {
          throw new Error(datos.error || "Error cargando el perfil");
        }

        setPerfilTrabajador(datos);
      } catch (error) {
        if (!activo) {
          return;
        }

        console.error(error);
        setErrorPerfil(error.message);
        setPerfilTrabajador(null);
      } finally {
        if (activo) {
          setCargandoPerfil(false);
        }
      }
    };

    Promise.resolve().then(cargarPerfil);

    return () => {
      activo = false;
    };
  }, [trabajadorPerfil, periodoPerfil, fechaPerfil, mesPerfil]);

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

  const construirPayloadTrabajador = (formulario) => ({
    nombre: formulario.nombre.trim(),
    apellidos: formulario.apellidos.trim() || null,
    codigo: formulario.codigo.trim().toUpperCase(),
    contacto: formulario.contacto.trim() || null,
    direccion: formulario.direccion.trim() || null,
    poblacion: formulario.poblacion.trim() || null,
  });

  const cambiarCampoTrabajador = (campo, valor) => {
    if (trabajadorEditando) {
      setTrabajadorEditando({ ...trabajadorEditando, [campo]: valor });
    } else {
      setNuevoTrabajador({ ...nuevoTrabajador, [campo]: valor });
    }
  };

  const crearTrabajador = async (event) => {
    event.preventDefault();

    if (!nuevoTrabajador.nombre.trim() || !nuevoTrabajador.codigo.trim()) {
      setError("Escribe el nombre y el código del trabajador.");
      return;
    }

    setGuardandoTrabajador(true);
    setError("");

    try {
      const respuesta = await fetch(`${API_BASE}/trabajadores`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(construirPayloadTrabajador(nuevoTrabajador)),
      });

      const datos = await respuesta.json();

      if (!respuesta.ok || !datos.ok) {
        throw new Error(datos.error || "Error creando trabajador");
      }

      setNuevoTrabajador({ ...TRABAJADOR_FORM_VACIO });

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

    if (
      !trabajadorEditando?.nombre.trim() ||
      !trabajadorEditando?.codigo.trim()
    ) {
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
          body: JSON.stringify(
            construirPayloadTrabajador(trabajadorEditando),
          ),
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
  // CREAR / EDITAR / ELIMINAR CASA
  // =========================================

  const construirPayloadCasa = (formulario, minutos) => ({
    nombre: formulario.nombre.trim(),
    nombre_cliente: formulario.nombre_cliente.trim() || null,
    apellidos_cliente: formulario.apellidos_cliente.trim() || null,
    direccion: formulario.direccion.trim() || null,
    contacto: formulario.contacto.trim() || null,
    codigo_postal: formulario.codigo_postal.trim() || null,
    poblacion: formulario.poblacion.trim() || null,
    tipo: formulario.tipo || null,
    frecuencia_texto: formulario.frecuencia_texto.trim() || null,
    visitas_por_periodo:
      formulario.visitas_por_periodo === ""
        ? null
        : Number(formulario.visitas_por_periodo),
    periodo_dias:
      formulario.periodo_dias === "" ? null : Number(formulario.periodo_dias),
    precio_hora:
      formulario.precio_hora === "" ? null : formulario.precio_hora,
    duracion_minutos: minutos,
    emite_factura: formulario.emite_factura ? 1 : 0,
    observaciones: formulario.observaciones.trim() || null,
  });

  const guardarCasa = async (event) => {
    event.preventDefault();

    const formulario = casaEditando ?? nuevaCasa;

    if (!formulario.nombre.trim()) {
      setError("Escribe el nombre de la casa.");
      return;
    }

    const duracion = parsearHorasAMinutos(formulario.duracion_minutos);

    if (duracion.error) {
      setError("");
      setErrorDuracionCasa(duracion.error);
      return;
    }

    setGuardandoCasa(true);
    setError("");
    setErrorDuracionCasa("");

    try {
      const esEdicion = Boolean(casaEditando);

      const respuesta = await fetch(
        esEdicion ? `${API_BASE}/casas/${casaEditando.id}` : `${API_BASE}/casas`,
        {
          method: esEdicion ? "PUT" : "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(
            construirPayloadCasa(formulario, duracion.minutos),
          ),
        },
      );

      const datos = await respuesta.json();

      if (!respuesta.ok || !datos.ok) {
        throw new Error(datos.error || "Error guardando la casa");
      }

      if (esEdicion) {
        setCasaEditando(null);
      } else {
        setNuevaCasa({ ...CASA_FORM_VACIA });
      }

      await cargarDatos();
    } catch (error) {
      console.error(error);
      setError(error.message);
    } finally {
      setGuardandoCasa(false);
    }
  };

  const eliminarCasa = async (casa) => {
    const confirmado = window.confirm(
      `¿Eliminar la casa "${casa.nombre}"? Esta acción no se puede deshacer.`,
    );

    if (!confirmado) {
      return;
    }

    try {
      setError("");

      const respuesta = await fetch(`${API_BASE}/casas/${casa.id}`, {
        method: "DELETE",
      });

      const datos = await respuesta.json();

      if (respuesta.status === 409) {
        const detalle = datos.detalle
          ? ` (${datos.detalle.horarios} horarios, ${datos.detalle.facturas} facturas)`
          : "";

        setError(
          `${datos.error}${detalle}. ${
            datos.sugerencia || "Desactívala en su lugar."
          }`,
        );
        return;
      }

      if (!respuesta.ok || !datos.ok) {
        throw new Error(datos.error || "Error eliminando la casa");
      }

      if (casaEditando?.id === casa.id) {
        setCasaEditando(null);
      }

      await cargarDatos();
    } catch (error) {
      console.error(error);
      setError(error.message);
    }
  };

  const formularioCasa = casaEditando ?? nuevaCasa;

  const cambiarCampoCasa = (campo, valor) => {
    if (casaEditando) {
      setCasaEditando({ ...casaEditando, [campo]: valor });
    } else {
      setNuevaCasa({ ...nuevaCasa, [campo]: valor });
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
    setPestanaHorario("analizar");
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

      const respuesta = await fetch(`${API_BASE}/horarios/analizar`, {
        method: "POST",
        body: formData,
      });

      const datos = await respuesta.json();

      if (!respuesta.ok) {
        throw new Error(datos.error || "Error analizando la imagen");
      }

      setResultado(datos);
      setEditandoIndex(null);
      // El análisis ha terminado: pasamos a la pestaña de revisión.
      setPestanaHorario("revisar");
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
  // CREAR CASA DESDE LA REVISIÓN
  // =========================================

  const crearCasaDesdeRevision = async (servicioIndex) => {
    const servicio = resultado?.servicios[servicioIndex];

    if (!servicio) {
      return;
    }

    const nombre = String(servicio.casa.nombre || "").trim();

    if (!nombre) {
      setError("La casa no tiene un nombre válido.");
      return;
    }

    setCasaCreandoIndex(servicioIndex);
    setError("");

    try {
      const respuesta = await fetch(`${API_BASE}/casas`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ nombre }),
      });

      const datos = await respuesta.json();

      if (!respuesta.ok || !datos.ok) {
        throw new Error(datos.error || "Error creando la casa");
      }

      const nuevaCasa = datos.casa;

      setResultado((actual) => {
        const servicioActual = actual?.servicios[servicioIndex];

        // Si la lista cambió mientras se creaba la casa, no tocamos otra fila.
        if (!servicioActual || servicioActual.casa.nombre !== nombre) {
          return actual;
        }

        const serviciosActualizados = [...actual.servicios];

        serviciosActualizados[servicioIndex] = {
          ...servicioActual,
          casa: {
            nombre: nuevaCasa.nombre,
            encontrada: true,
            datos: nuevaCasa,
          },
        };

        return {
          ...actual,
          servicios: serviciosActualizados,
        };
      });

      // Refrescamos el catálogo para que la casa aparezca en los desplegables.
      setCasas((actual) =>
        actual.some((casa) => casa.id === nuevaCasa.id)
          ? actual
          : [...actual, nuevaCasa],
      );

      const respuestaCasas = await fetch(`${API_BASE}/casas`);
      const datosCasas = await respuestaCasas.json();

      if (respuestaCasas.ok && datosCasas.ok) {
        setCasas(datosCasas.casas || []);
      }
    } catch (error) {
      console.error(error);
      setError(error.message);
    } finally {
      setCasaCreandoIndex(null);
    }
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
  // ELIMINAR SERVICIO (CASA) DE LA LISTA
  // =========================================

  const eliminarServicio = (servicioIndex) => {
    setResultado((actual) => {
      if (!actual) {
        return actual;
      }

      return {
        ...actual,
        servicios: actual.servicios.filter(
          (_, index) => index !== servicioIndex,
        ),
      };
    });

    setEditandoIndex((actual) => {
      if (actual === null) {
        return null;
      }

      if (actual === servicioIndex) {
        return null;
      }

      return actual > servicioIndex ? actual - 1 : actual;
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

      const respuesta = await fetch(`${API_BASE}/horarios/guardar-completo`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fecha,
          imagen_original: imagen?.name || null,
          servicios: serviciosParaGuardar,
        }),
      });

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
    <>
      {/* ================================= */}
      {/* DATOS */}
      {/* ================================= */}

        {seccion === "horarios" && !cargandoDatos && (
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

        {seccion === "gestion" && (
          <section className="card">
            <div className="gestion-header">
              <div>
                <h2>Gestión</h2>

                <p>Administra las casas y trabajadores registrados.</p>
              </div>
            </div>

            <div
              className="pestanas pestanas-gestion"
              role="tablist"
              aria-label="Gestión"
            >
              <button
                type="button"
                role="tab"
                id="tab-casas"
                aria-selected={pestanaGestion === "casas"}
                aria-controls="panel-casas"
                className={`pestana ${
                  pestanaGestion === "casas" ? "pestana-activa" : ""
                }`}
                onClick={() => setPestanaGestion("casas")}
              >
                Casas
                <span className="pestana-badge">{casas.length}</span>
              </button>

              <button
                type="button"
                role="tab"
                id="tab-trabajadores"
                aria-selected={pestanaGestion === "trabajadores"}
                aria-controls="panel-trabajadores"
                className={`pestana ${
                  pestanaGestion === "trabajadores" ? "pestana-activa" : ""
                }`}
                onClick={() => setPestanaGestion("trabajadores")}
              >
                Trabajadores
                <span className="pestana-badge">{trabajadores.length}</span>
              </button>
            </div>

            {pestanaGestion === "casas" && (
              <div
                className="gestion-panel"
                id="panel-casas"
                role="tabpanel"
                aria-labelledby="tab-casas"
              >
                {/* FORMULARIO DE CASA */}

                <div className="gestion-seccion">
                  <div className="gestion-seccion-cabecera">
                    <h3>{casaEditando ? "Editar casa" : "Añadir casa"}</h3>

                    {casaEditando && (
                      <span className="gestion-contador">
                        Editando: {casaEditando.nombre || "casa"}
                      </span>
                    )}
                  </div>

                  <form onSubmit={guardarCasa} className="form-casa">
                    <div className="form-grid">
                      <label className="campo-form">
                        <span>Nombre de la casa *</span>
                        <input
                          type="text"
                          value={formularioCasa.nombre}
                          onChange={(event) =>
                            cambiarCampoCasa("nombre", event.target.value)
                          }
                          required
                        />
                      </label>

                      <label className="campo-form">
                        <span>Nombre del cliente</span>
                        <input
                          type="text"
                          value={formularioCasa.nombre_cliente}
                          onChange={(event) =>
                            cambiarCampoCasa(
                              "nombre_cliente",
                              event.target.value,
                            )
                          }
                        />
                      </label>

                      <label className="campo-form">
                        <span>Apellidos del cliente</span>
                        <input
                          type="text"
                          value={formularioCasa.apellidos_cliente}
                          onChange={(event) =>
                            cambiarCampoCasa(
                              "apellidos_cliente",
                              event.target.value,
                            )
                          }
                        />
                      </label>

                      <label className="campo-form">
                        <span>Contacto</span>
                        <input
                          type="text"
                          value={formularioCasa.contacto}
                          onChange={(event) =>
                            cambiarCampoCasa("contacto", event.target.value)
                          }
                        />
                      </label>

                      <label className="campo-form campo-ancho">
                        <span>Dirección</span>
                        <input
                          type="text"
                          value={formularioCasa.direccion}
                          onChange={(event) =>
                            cambiarCampoCasa("direccion", event.target.value)
                          }
                        />
                      </label>

                      <label className="campo-form">
                        <span>Código postal</span>
                        <input
                          type="text"
                          value={formularioCasa.codigo_postal}
                          onChange={(event) =>
                            cambiarCampoCasa(
                              "codigo_postal",
                              event.target.value,
                            )
                          }
                        />
                      </label>

                      <label className="campo-form">
                        <span>Población</span>
                        <input
                          type="text"
                          value={formularioCasa.poblacion}
                          onChange={(event) =>
                            cambiarCampoCasa("poblacion", event.target.value)
                          }
                        />
                      </label>

                      <label className="campo-form">
                        <span>Tipo de servicio</span>
                        <select
                          value={formularioCasa.tipo}
                          onChange={(event) =>
                            cambiarCampoCasa("tipo", event.target.value)
                          }
                        >
                          <option value="">Sin clasificar</option>
                          {TIPOS_SERVICIO.map((tipo) => (
                            <option key={tipo.valor} value={tipo.valor}>
                              {tipo.etiqueta}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="campo-form">
                        <span>Frecuencia</span>
                        <input
                          type="text"
                          placeholder="Ej.: SEMANAL, C/15 DÍAS"
                          value={formularioCasa.frecuencia_texto}
                          onChange={(event) =>
                            cambiarCampoCasa(
                              "frecuencia_texto",
                              event.target.value,
                            )
                          }
                        />
                      </label>

                      <label className="campo-form">
                        <span>Visitas por periodo</span>
                        <input
                          type="number"
                          min="0"
                          max="255"
                          value={formularioCasa.visitas_por_periodo}
                          onChange={(event) =>
                            cambiarCampoCasa(
                              "visitas_por_periodo",
                              event.target.value,
                            )
                          }
                        />
                      </label>

                      <label className="campo-form">
                        <span>Días del periodo</span>
                        <input
                          type="number"
                          min="1"
                          max="3650"
                          value={formularioCasa.periodo_dias}
                          onChange={(event) =>
                            cambiarCampoCasa(
                              "periodo_dias",
                              event.target.value,
                            )
                          }
                        />
                      </label>

                      <label className="campo-form">
                        <span>Precio por hora (€)</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={formularioCasa.precio_hora}
                          onChange={(event) =>
                            cambiarCampoCasa(
                              "precio_hora",
                              event.target.value,
                            )
                          }
                        />
                      </label>

                      <label className="campo-duracion">
                        <span>Duración de referencia (horas)</span>

                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="Ej.: 4 o 1,5"
                          aria-label="Duración de referencia (horas)"
                          aria-invalid={
                            errorDuracionCasa ? "true" : undefined
                          }
                          aria-describedby={
                            errorDuracionCasa
                              ? "error-duracion-casa"
                              : undefined
                          }
                          value={formularioCasa.duracion_minutos}
                          onChange={(event) => {
                            setErrorDuracionCasa("");
                            cambiarCampoCasa(
                              "duracion_minutos",
                              event.target.value,
                            );
                          }}
                        />

                        {errorDuracionCasa ? (
                          <small
                            className="campo-error"
                            id="error-duracion-casa"
                            role="alert"
                          >
                            {errorDuracionCasa}
                          </small>
                        ) : (
                          <small className="campo-ayuda">
                            Referencia del Excel. No se usa para calcular horas
                            trabajadas.
                          </small>
                        )}
                      </label>

                      <label className="campo-form campo-checkbox">
                        <input
                          type="checkbox"
                          checked={formularioCasa.emite_factura}
                          onChange={(event) =>
                            cambiarCampoCasa(
                              "emite_factura",
                              event.target.checked,
                            )
                          }
                        />
                        <span>Emite factura</span>
                      </label>

                      <label className="campo-form campo-ancho">
                        <span>Observaciones</span>
                        <textarea
                          rows="3"
                          value={formularioCasa.observaciones}
                          onChange={(event) =>
                            cambiarCampoCasa(
                              "observaciones",
                              event.target.value,
                            )
                          }
                        />
                      </label>
                    </div>

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
                          onClick={() => {
                            setErrorDuracionCasa("");
                            setCasaEditando(null);
                          }}
                        >
                          Cancelar
                        </button>
                      )}
                    </div>
                  </form>
                </div>

                {/* LISTADO DE CASAS */}

                <div className="gestion-seccion">
                  <div className="gestion-seccion-cabecera">
                    <h3>Casas registradas</h3>

                    <span className="gestion-contador">
                      {casas.length} registradas · {casasPendientes} con datos
                      pendientes
                    </span>
                  </div>

                  <div className="barra-busqueda">
                    <input
                      type="search"
                      placeholder="Buscar por nombre, cliente, dirección o población"
                      aria-label="Buscar casa"
                      value={busquedaCasa}
                      onChange={(event) => setBusquedaCasa(event.target.value)}
                    />

                    <label className="filtro-pendientes">
                      <input
                        type="checkbox"
                        checked={soloPendientes}
                        onChange={(event) =>
                          setSoloPendientes(event.target.checked)
                        }
                      />
                      Solo con datos pendientes
                    </label>
                  </div>

                  <div className="lista-gestion lista-casas">
                    {casas.length === 0 ? (
                      <p className="gestion-vacio">
                        No hay casas registradas.
                      </p>
                    ) : casasFiltradas.length === 0 ? (
                      <p className="gestion-vacio">
                        Ninguna casa coincide con la búsqueda.
                      </p>
                    ) : (
                      casasFiltradas.map((casa) => {
                        const activa = normalizarActivo(casa.activo);
                        const pendiente = normalizarActivo(
                          casa.datos_pendientes,
                        );
                        const faltantes = casa.campos_faltantes || [];

                        return (
                          <div
                            className={`item-gestion item-casa ${
                              activa ? "" : "item-inactivo"
                            }`}
                            key={casa.id}
                          >
                            <div className="item-casa-datos">
                              <div className="item-casa-titulo">
                                <strong>{casa.nombre}</strong>

                                {!activa && (
                                  <span className="badge badge-inactiva">
                                    Inactiva
                                  </span>
                                )}

                                {pendiente && (
                                  <span
                                    className="badge badge-pendiente"
                                    title={
                                      faltantes.length > 0
                                        ? `Falta: ${faltantes.join(", ")}`
                                        : "Faltan datos"
                                    }
                                  >
                                    Datos pendientes
                                  </span>
                                )}
                              </div>

                              <div className="item-casa-detalle">
                                <span>
                                  {[casa.nombre_cliente, casa.apellidos_cliente]
                                    .filter(Boolean)
                                    .join(" ") || "Sin cliente"}
                                </span>
                                <span>
                                  {casa.direccion || "Sin dirección"}
                                </span>
                                <span>
                                  {[casa.codigo_postal, casa.poblacion]
                                    .filter(Boolean)
                                    .join(" ") || "Sin población"}
                                </span>
                                <span>{casa.contacto || "Sin contacto"}</span>
                                <span>
                                  {formatearDuracionHoras(
                                    casa.duracion_minutos,
                                  )}
                                </span>
                                <span>
                                  {casa.frecuencia_texto || "Sin frecuencia"}
                                </span>
                                <span>
                                  {casa.precio_hora === null ||
                                  casa.precio_hora === undefined
                                    ? "Sin precio"
                                    : `${Number(casa.precio_hora).toFixed(2)} €/h`}
                                </span>
                              </div>

                              {pendiente && faltantes.length > 0 && (
                                <p className="item-casa-faltantes">
                                  Falta: {faltantes.join(", ")}
                                </p>
                              )}
                            </div>

                            <div className="item-acciones">
                              <button
                                type="button"
                                className="btn-mini"
                                onClick={() => {
                                  setErrorDuracionCasa("");
                                  setCasaEditando({
                                    ...casaAFormulario(casa),
                                    id: casa.id,
                                  });
                                }}
                              >
                                Editar
                              </button>

                              <button
                                type="button"
                                className="btn-mini"
                                onClick={() => cambiarActivoCasa(casa)}
                              >
                                {activa ? "Desactivar" : "Activar"}
                              </button>

                              <button
                                type="button"
                                className="btn-mini btn-peligro"
                                onClick={() => eliminarCasa(casa)}
                              >
                                Eliminar
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            )}

            {pestanaGestion === "trabajadores" && (
              <div
                className="gestion-panel"
                id="panel-trabajadores"
                role="tabpanel"
                aria-labelledby="tab-trabajadores"
              >
                {/* FORMULARIO DE TRABAJADOR */}

                <div className="gestion-seccion">
                  <div className="gestion-seccion-cabecera">
                    <h3>
                      {trabajadorEditando
                        ? "Editar trabajador"
                        : "Añadir trabajador"}
                    </h3>

                    {trabajadorEditando && (
                      <span className="gestion-contador">
                        Editando:{" "}
                        {nombreCompletoTrabajador(trabajadorEditando)}
                      </span>
                    )}
                  </div>

                  <form
                    onSubmit={
                      trabajadorEditando
                        ? guardarTrabajadorEditado
                        : crearTrabajador
                    }
                    className="form-trabajador"
                  >
                    <div className="form-grid">
                      <label className="campo-form">
                        <span>Nombre *</span>
                        <input
                          type="text"
                          value={
                            trabajadorEditando
                              ? trabajadorEditando.nombre
                              : nuevoTrabajador.nombre
                          }
                          onChange={(event) =>
                            cambiarCampoTrabajador(
                              "nombre",
                              event.target.value,
                            )
                          }
                          required
                        />
                      </label>

                      <label className="campo-form">
                        <span>Apellidos</span>
                        <input
                          type="text"
                          value={
                            trabajadorEditando
                              ? trabajadorEditando.apellidos || ""
                              : nuevoTrabajador.apellidos
                          }
                          onChange={(event) =>
                            cambiarCampoTrabajador(
                              "apellidos",
                              event.target.value,
                            )
                          }
                        />
                      </label>

                      <label className="campo-form">
                        <span>Código o clave *</span>
                        <input
                          type="text"
                          maxLength="10"
                          value={
                            trabajadorEditando
                              ? trabajadorEditando.codigo
                              : nuevoTrabajador.codigo
                          }
                          onChange={(event) =>
                            cambiarCampoTrabajador(
                              "codigo",
                              event.target.value.toUpperCase(),
                            )
                          }
                          required
                        />
                      </label>

                      <label className="campo-form">
                        <span>Contacto</span>
                        <input
                          type="text"
                          value={
                            trabajadorEditando
                              ? trabajadorEditando.contacto || ""
                              : nuevoTrabajador.contacto
                          }
                          onChange={(event) =>
                            cambiarCampoTrabajador(
                              "contacto",
                              event.target.value,
                            )
                          }
                        />
                      </label>

                      <label className="campo-form">
                        <span>Población</span>
                        <input
                          type="text"
                          value={
                            trabajadorEditando
                              ? trabajadorEditando.poblacion || ""
                              : nuevoTrabajador.poblacion
                          }
                          onChange={(event) =>
                            cambiarCampoTrabajador(
                              "poblacion",
                              event.target.value,
                            )
                          }
                        />
                      </label>

                      <label className="campo-form campo-ancho">
                        <span>Dirección</span>
                        <input
                          type="text"
                          value={
                            trabajadorEditando
                              ? trabajadorEditando.direccion || ""
                              : nuevoTrabajador.direccion
                          }
                          onChange={(event) =>
                            cambiarCampoTrabajador(
                              "direccion",
                              event.target.value,
                            )
                          }
                        />
                      </label>
                    </div>

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

                {/* RESUMEN DE HORAS TRABAJADAS */}

                <div className="gestion-seccion">
                  <div className="gestion-seccion-cabecera">
                    <h3>Horas trabajadas</h3>

                    <span className="gestion-contador">
                      Total del día:{" "}
                      <strong>
                        {formatearMinutosTrabajados(totalMinutosResumen)}
                      </strong>
                    </span>
                  </div>

                  <div className="resumen-fecha">
                    <label htmlFor="fecha-resumen">Fecha</label>

                    <button
                      type="button"
                      className="btn-secondary btn-fecha"
                      aria-label="Día anterior"
                      onClick={() => cambiarFechaResumen(-1)}
                    >
                      ◀
                    </button>

                    <input
                      id="fecha-resumen"
                      type="date"
                      value={fechaResumen}
                      onChange={(event) => setFechaResumen(event.target.value)}
                    />

                    <button
                      type="button"
                      className="btn-secondary btn-fecha"
                      aria-label="Día siguiente"
                      onClick={() => cambiarFechaResumen(1)}
                    >
                      ▶
                    </button>

                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setFechaResumen(aISOlocal(new Date()))}
                    >
                      Hoy
                    </button>
                  </div>

                  {errorResumen && <div className="error">{errorResumen}</div>}

                  {cargandoResumen ? (
                    <p className="gestion-vacio">Cargando resumen...</p>
                  ) : resumenTrabajadores.length === 0 ? (
                    <p className="gestion-vacio">
                      No hay trabajadores activos o no tienen horas registradas
                      en esta fecha.
                    </p>
                  ) : (
                    <div className="tabla-responsive">
                      <table className="tabla-datos tabla-resumen">
                        <thead>
                          <tr>
                            <th>Trabajador</th>
                            <th>Código</th>
                            <th>Horas del día</th>
                          </tr>
                        </thead>

                        <tbody>
                          {resumenTrabajadores.map((trabajador) => (
                            <tr key={trabajador.id}>
                              <td>
                                {trabajador.nombre}
                              </td>
                              <td>{trabajador.codigo}</td>
                              <td>
                                {formatearMinutosTrabajados(
                                  trabajador.minutos_trabajados,
                                )}
                              </td>
                            </tr>
                          ))}

                          <tr className="fila-total">
                            <td>
                              <strong>Total</strong>
                            </td>
                            <td />
                            <td>
                              <strong>
                                {formatearMinutosTrabajados(
                                  totalMinutosResumen,
                                )}
                              </strong>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* LISTADO DE TRABAJADORES */}

                <div className="gestion-seccion">
                  <div className="gestion-seccion-cabecera">
                    <h3>Trabajadores registrados</h3>

                    <span className="gestion-contador">
                      {trabajadores.length} registrados ·{" "}
                      {trabajadoresPendientes} con datos pendientes
                    </span>
                  </div>

                  <div className="barra-busqueda">
                    <input
                      type="search"
                      placeholder="Buscar por nombre, apellidos o código"
                      aria-label="Buscar trabajador"
                      value={busquedaTrabajador}
                      onChange={(event) =>
                        setBusquedaTrabajador(event.target.value)
                      }
                    />
                  </div>

                  <div className="lista-gestion lista-trabajadores">
                    {trabajadores.length === 0 ? (
                      <p className="gestion-vacio">
                        No hay trabajadores registrados.
                      </p>
                    ) : trabajadoresFiltrados.length === 0 ? (
                      <p className="gestion-vacio">
                        Ningún trabajador coincide con la búsqueda.
                      </p>
                    ) : (
                      trabajadoresFiltrados.map((trabajador) => {
                        const activo = normalizarActivo(trabajador.activo);
                        const pendiente = normalizarActivo(
                          trabajador.datos_pendientes,
                        );

                        return (
                          <div
                            className={`item-gestion item-trabajador ${
                              activo ? "" : "item-inactivo"
                            }`}
                            key={trabajador.id}
                          >
                            <div className="item-trabajador-datos">
                              <div className="item-casa-titulo">
                                <button
                                  type="button"
                                  className="btn-link btn-nombre-trabajador"
                                  onClick={() =>
                                    abrirPerfilTrabajador(trabajador)
                                  }
                                  title="Ver perfil y horas del trabajador"
                                >
                                  {nombreCompletoTrabajador(trabajador)}
                                </button>

                                <span className="codigo-trabajador">
                                  {trabajador.codigo}
                                </span>

                                {!activo && (
                                  <span className="badge badge-inactiva">
                                    Inactivo
                                  </span>
                                )}

                                {pendiente && (
                                  <span
                                    className="badge badge-pendiente"
                                    title="Faltan datos de contacto, dirección o población"
                                  >
                                    Datos pendientes
                                  </span>
                                )}
                              </div>

                              <div className="item-casa-detalle">
                                <span>
                                  {trabajador.contacto || "Sin contacto"}
                                </span>
                                <span>
                                  {trabajador.poblacion || "Sin población"}
                                </span>
                                {trabajador.direccion && (
                                  <span>{trabajador.direccion}</span>
                                )}
                              </div>
                            </div>

                            <div className="item-acciones">
                              <button
                                type="button"
                                className="btn-mini"
                                onClick={() =>
                                  abrirPerfilTrabajador(trabajador)
                                }
                              >
                                Perfil
                              </button>

                              <button
                                type="button"
                                className="btn-mini"
                                onClick={() =>
                                  setTrabajadorEditando({ ...trabajador })
                                }
                              >
                                Editar
                              </button>

                              <button
                                type="button"
                                className="btn-mini"
                                onClick={() =>
                                  cambiarActivoTrabajador(trabajador)
                                }
                              >
                                {activo ? "Desactivar" : "Activar"}
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        {/* ================================= */}
        {/* HISTORIAL */}
        {/* ================================= */}

        {seccion === "historial" && (
          <section className="card">
            <div className="gestion-header">
              <div>
                <h2>Historial</h2>

                <p>Consulta los horarios guardados sin modificarlos.</p>
              </div>
            </div>

            {cargandoHistorial && historial.length === 0 ? (
              <p className="gestion-vacio">Cargando historial...</p>
            ) : historial.length === 0 ? (
              <div className="estado-vacio">
                <span className="estado-vacio-icono" aria-hidden="true">
                  🗓️
                </span>

                <h3>Todavía no hay horarios guardados</h3>

                <p>
                  Cuando analices y guardes un horario desde la pestaña
                  Horarios, aparecerá aquí para consultarlo cuando quieras.
                </p>

                <Link className="btn-primary estado-vacio-accion" to="/horarios">
                  Ir a Horarios
                </Link>
              </div>
            ) : (
              <div className="historial-layout">
                <div className="historial-lista">
                  {historial.map((dia) => (
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
                  ))}
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
        )}

        {/* ================================= */}
        {/* ANALIZAR / REVISAR (PESTAÑAS) */}
        {/* ================================= */}

        {seccion === "horarios" && (
        <div className="seccion-horarios">
          <div className="pestanas" role="tablist" aria-label="Horarios">
            <button
              type="button"
              role="tab"
              id="tab-analizar"
              aria-selected={pestanaHorario === "analizar"}
              aria-controls="panel-analizar"
              className={`pestana ${
                pestanaHorario === "analizar" ? "pestana-activa" : ""
              }`}
              onClick={() => setPestanaHorario("analizar")}
            >
              1. Analizar horario
            </button>

            <button
              type="button"
              role="tab"
              id="tab-revisar"
              aria-selected={pestanaHorario === "revisar"}
              aria-controls="panel-revisar"
              className={`pestana ${
                pestanaHorario === "revisar" ? "pestana-activa" : ""
              }`}
              onClick={() => setPestanaHorario("revisar")}
              disabled={!resultado}
              title={
                resultado
                  ? "Revisar los servicios detectados"
                  : "Analiza una imagen para revisar los servicios"
              }
            >
              2. Revisar horario

              {resultado && (
                <span className="pestana-badge">
                  {resultado.servicios.length}
                </span>
              )}

              {resultado && contarErrores() > 0 && (
                <span className="pestana-badge pestana-badge-aviso">
                  {contarErrores()}
                </span>
              )}
            </button>
          </div>

          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}

          {pestanaHorario === "analizar" && (
            <section
              className="card"
              id="panel-analizar"
              role="tabpanel"
              aria-labelledby="tab-analizar"
            >
              <div className="panel-analizar">
                <div className="panel-upload">
                  <h2>Analizar horario</h2>

                  <p className="panel-upload-ayuda">
                    Selecciona una fotografía del horario y revísala antes de
                    analizarla.
                  </p>

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

                    {imagen && (
                      <span className="file-name">{imagen.name}</span>
                    )}
                  </div>

                  {imagen ? (
                    <figure className="vista-previa">
                      <img
                        src={vistaPrevia}
                        alt={`Vista previa de ${imagen.name}`}
                      />
                      <figcaption>{imagen.name}</figcaption>
                    </figure>
                  ) : (
                    <div className="vista-previa vista-previa-vacia">
                      <span>No hay ninguna imagen seleccionada</span>
                    </div>
                  )}

                  <button
                    type="button"
                    className="btn-primary btn-analizar"
                    onClick={analizarImagen}
                    disabled={!imagen || cargando}
                  >
                    {cargando ? "Analizando..." : "Analizar horario"}
                  </button>

                  {cargando && (
                    <div className="cargando-panel" role="status">
                      <span className="spinner" aria-hidden="true" />
                      Analizando la imagen con IA. Esto puede tardar unos
                      segundos.
                    </div>
                  )}

                  {resultado && !cargando && (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setPestanaHorario("revisar")}
                    >
                      Ver {resultado.servicios.length} servicios detectados →
                    </button>
                  )}
                </div>
              </div>
            </section>
          )}

        {/* ================================= */}
        {/* RESULTADO */}
        {/* ================================= */}

        {pestanaHorario === "revisar" && resultado && (
          <section
            className="card"
            id="panel-revisar"
            role="tabpanel"
            aria-labelledby="tab-revisar"
          >
            <div className="resultado-header">
              <div>
                <h2>Revisar horario</h2>

                <div className="resumen-servicios">
                  <span className="dato-chip">
                    {resultado.servicios.length} servicios detectados
                  </span>

                  <span
                    className={
                      contarErrores() > 0
                        ? "dato-chip dato-chip-aviso"
                        : "dato-chip dato-chip-ok"
                    }
                  >
                    {contarErrores() > 0
                      ? `${contarErrores()} pendientes de revisión`
                      : "Sin pendientes"}
                  </span>
                </div>
              </div>

              <div className="guardar-panel">
                <label htmlFor="fecha-horario">Fecha</label>

                <input
                  id="fecha-horario"
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
                  disabled={
                    guardando ||
                    resultado.servicios.length === 0 ||
                    contarErrores() > 0
                  }
                >
                  {guardando ? "Guardando..." : "💾 Guardar horario"}
                </button>
              </div>
            </div>

            <div className="tabla-scroll">
              <table className="tabla-servicios">
                <thead>
                  <tr>
                    <th scope="col">Casa / Cliente</th>
                    <th scope="col">Hora de inicio</th>
                    <th scope="col">Hora de fin</th>
                    <th scope="col">Trabajadores</th>
                    <th scope="col" className="col-acciones">
                      Acciones
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {resultado.servicios.map((servicio, index) => {
                    const estaEditando = editandoIndex === index;

                    const tieneErrores = servicioTieneErrores(servicio);

                    // =================================
                    // EDICIÓN
                    // =================================

                    if (estaEditando) {
                      return (
                        <tr className="fila-edicion" key={index}>
                          <td>
                            <label htmlFor={`casa-${index}`}>Casa</label>

                            <select
                              id={`casa-${index}`}
                              value={
                                servicio.casa.encontrada &&
                                servicio.casa.datos
                                  ? servicio.casa.datos.id
                                  : ""
                              }
                              className={
                                !servicio.casa.encontrada
                                  ? "select-warning"
                                  : ""
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

                            {!servicio.casa.encontrada && (
                              <button
                                type="button"
                                className="btn-anadir-casa"
                                onClick={() =>
                                  crearCasaDesdeRevision(index)
                                }
                                disabled={casaCreandoIndex === index}
                              >
                                {casaCreandoIndex === index
                                  ? "Añadiendo..."
                                  : `➕ Añadir «${servicio.casa.nombre}»`}
                              </button>
                            )}
                          </td>

                          <td>
                            <label htmlFor={`inicio-${index}`}>Inicio</label>

                            <input
                              id={`inicio-${index}`}
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
                          </td>

                          <td>
                            <label htmlFor={`fin-${index}`}>Fin</label>

                            <input
                              id={`fin-${index}`}
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
                          </td>

                          <td>
                            <label>Trabajadores</label>

                            <div className="trabajadores-edicion">
                              {servicio.trabajadores.map(
                                (trabajador, trabajadorIndex) => (
                                  <div
                                    className="trabajador-edicion"
                                    key={trabajadorIndex}
                                  >
                                    <select
                                      aria-label={`Trabajador ${
                                        trabajadorIndex + 1
                                      } del servicio ${index + 1}`}
                                      value={
                                        trabajador.encontrado &&
                                        trabajador.trabajador
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
                                          {trabajador.codigo ||
                                            "Sin seleccionar"}
                                          {" — no registrado"}
                                        </option>
                                      )}

                                      {trabajadoresActivos.map((item) => (
                                        <option
                                          key={item.id}
                                          value={item.codigo}
                                        >
                                          {item.codigo}
                                          {" - "}
                                          {item.nombre}
                                        </option>
                                      ))}
                                    </select>

                                    <button
                                      type="button"
                                      className="btn-x"
                                      aria-label={`Quitar trabajador ${
                                        trabajadorIndex + 1
                                      } del servicio ${index + 1}`}
                                      onClick={() =>
                                        eliminarTrabajador(
                                          index,
                                          trabajadorIndex,
                                        )
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
                          </td>

                          <td className="col-acciones">
                            <div className="acciones-servicio">
                              <button
                                type="button"
                                className="btn-guardar-edicion"
                                onClick={() => setEditandoIndex(null)}
                              >
                                ✓ Listo
                              </button>

                              <button
                                type="button"
                                className="btn-eliminar-servicio"
                                onClick={() => eliminarServicio(index)}
                              >
                                🗑 Eliminar
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    }

                    // =================================
                    // VISTA NORMAL
                    // =================================

                    return (
                      <tr
                        key={index}
                        className={tieneErrores ? "fila-con-error" : ""}
                      >
                        <td className="celda-casa">
                          <strong>{servicio.casa.nombre}</strong>

                          {!servicio.casa.encontrada && (
                            <span className="mini-warning">
                              ⚠️ No registrada
                            </span>
                          )}
                        </td>

                        <td className="celda-hora">
                          <strong>
                            {formatearHora(servicio.hora_inicio)}
                          </strong>

                          {!servicio.hora_inicio && (
                            <span className="mini-warning">
                              ⚠️ Falta hora
                            </span>
                          )}
                        </td>

                        <td className="celda-hora">
                          <strong>{formatearHora(servicio.hora_fin)}</strong>

                          {!servicio.hora_fin && (
                            <span className="mini-warning">
                              ⚠️ Falta hora
                            </span>
                          )}
                        </td>

                        <td>
                          {servicio.trabajadores.length === 0 ? (
                            <span className="sin-asignar">Sin asignar</span>
                          ) : (
                            <div className="trabajadores-celda">
                              {servicio.trabajadores.map(
                                (trabajador, trabajadorIndex) => {
                                  const valido =
                                    trabajador.encontrado &&
                                    trabajador.trabajador;

                                  return (
                                    <span
                                      key={trabajadorIndex}
                                      className={
                                        valido
                                          ? "trabajador-tag"
                                          : "trabajador-tag trabajador-desconocido"
                                      }
                                      title={
                                        valido
                                          ? trabajador.trabajador.nombre
                                          : "Trabajador no registrado"
                                      }
                                    >
                                      {valido
                                        ? trabajador.trabajador.codigo
                                        : `⚠️ ${
                                            trabajador.codigo || "?"
                                          }`}
                                    </span>
                                  );
                                },
                              )}
                            </div>
                          )}
                        </td>

                        <td className="col-acciones">
                          <div className="acciones-servicio">
                            {!servicio.casa.encontrada && (
                              <button
                                type="button"
                                className="btn-anadir-casa"
                                onClick={() =>
                                  crearCasaDesdeRevision(index)
                                }
                                disabled={casaCreandoIndex === index}
                              >
                                {casaCreandoIndex === index
                                  ? "Añadiendo..."
                                  : "➕ Añadir casa"}
                              </button>
                            )}

                            <button
                              type="button"
                              className="btn-editar"
                              onClick={() => setEditandoIndex(index)}
                            >
                              ✏️ Editar
                            </button>

                            <button
                              type="button"
                              className="btn-eliminar-servicio"
                              onClick={() => eliminarServicio(index)}
                            >
                              🗑 Eliminar
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                  {resultado.servicios.length === 0 && (
                    <tr>
                      <td colSpan={5} className="tabla-servicios-vacia">
                        No quedan servicios en la lista. Puedes analizar otra
                        imagen o volver a revisar el horario.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}
        </div>
        )}

      {trabajadorPerfil && (
        <div
          className="modal-overlay"
          role="presentation"
          onClick={cerrarPerfilTrabajador}
        >
          <div
            className="modal-perfil"
            role="dialog"
            aria-modal="true"
            aria-labelledby="perfil-titulo"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-perfil-cabecera">
              <div>
                <h3 id="perfil-titulo">
                  {nombreCompletoTrabajador(trabajadorPerfil)}
                </h3>

                <p>Código: {trabajadorPerfil.codigo}</p>
              </div>

              <button
                type="button"
                className="btn-cerrar-modal"
                aria-label="Cerrar perfil"
                onClick={cerrarPerfilTrabajador}
              >
                ×
              </button>
            </div>

            <div
              className="perfil-periodos"
              role="tablist"
              aria-label="Periodo del perfil"
            >
              {["dia", "semana", "mes"].map((periodo) => (
                <button
                  key={periodo}
                  type="button"
                  role="tab"
                  aria-selected={periodoPerfil === periodo}
                  className={`perfil-periodo ${
                    periodoPerfil === periodo ? "perfil-periodo-activo" : ""
                  }`}
                  onClick={() => setPeriodoPerfil(periodo)}
                >
                  {ETIQUETAS_PERIODO[periodo]}
                </button>
              ))}
            </div>

            <div className="perfil-controles">
              {periodoPerfil === "mes" ? (
                <>
                  <label htmlFor="mes-perfil">Mes</label>
                  <input
                    id="mes-perfil"
                    type="month"
                    value={mesPerfil}
                    onChange={(event) => setMesPerfil(event.target.value)}
                  />
                </>
              ) : (
                <>
                  <label htmlFor="fecha-perfil">Fecha</label>
                  <input
                    id="fecha-perfil"
                    type="date"
                    value={fechaPerfil}
                    onChange={(event) => setFechaPerfil(event.target.value)}
                  />
                </>
              )}

              {periodoPerfil === "semana" && (
                <span className="perfil-rango">
                  {formatearFecha(rangoPerfilActual.desde)} –{" "}
                  {formatearFecha(rangoPerfilActual.hasta)}
                </span>
              )}
            </div>

            {errorPerfil && <div className="error">{errorPerfil}</div>}

            {cargandoPerfil ? (
              <p className="gestion-vacio">Cargando perfil...</p>
            ) : perfilTrabajador ? (
              <>
                <div className="datos-referencia perfil-resumen">
                  <div className="dato-box">
                    <span>
                      {ETIQUETAS_HORAS_PERIODO[periodoPerfil]}
                    </span>
                    <strong>
                      {formatearMinutosTrabajados(
                        perfilTrabajador.total_minutos,
                      )}
                    </strong>
                  </div>

                  <div className="dato-box">
                    <span>Servicios</span>
                    <strong>{perfilTrabajador.total_servicios}</strong>
                  </div>

                  <div className="dato-box">
                    <span>Casas distintas</span>
                    <strong>{perfilTrabajador.casas_distintas}</strong>
                  </div>
                </div>

                <div className="perfil-casas">
                  <h4>Casas realizadas</h4>

                  {casasPerfil.length === 0 ? (
                    <p className="gestion-vacio">
                      Sin casas en este periodo.
                    </p>
                  ) : (
                    <div className="perfil-casas-lista">
                      {casasPerfil.map((casa) => (
                        <span key={casa} className="perfil-casa-chip">
                          {casa}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="tabla-responsive">
                  <table className="tabla-datos tabla-perfil">
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
                      {perfilTrabajador.servicios.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="tabla-servicios-vacia">
                            Sin servicios en este periodo.
                          </td>
                        </tr>
                      ) : (
                        perfilTrabajador.servicios.map((servicio) => (
                          <tr key={servicio.id}>
                            <td className="celda-fecha">
                              {formatearFecha(servicio.fecha)}
                            </td>
                            <td>{servicio.casa}</td>
                            <td className="celda-horario">
                              {formatearHora(servicio.hora_inicio)} →{" "}
                              {formatearHora(servicio.hora_fin)}
                            </td>
                            <td>
                              {formatearMinutosTrabajados(
                                servicio.duracion_minutos,
                              )}
                            </td>
                            <td>
                              {servicio.otros_trabajadores
                                .map((trabajador) => trabajador.codigo)
                                .join(", ") || "-"}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </>
  );
}

function Layout() {
  const location = useLocation();

  return (
    <div className="app">
      <header className="header">
        <div className="header-content">
          <div className="header-brand">
            <h1>Claudia Netella</h1>
            <span className="header-etiqueta">Gestor de Horarios</span>
          </div>

          <nav className="app-nav" aria-label="Secciones">
            <Link
              to="/horarios"
              className={
                location.pathname.startsWith("/horarios")
                  ? "btn-primary"
                  : "btn-secondary"
              }
            >
              Horarios
            </Link>
            <Link
              to="/gestion"
              className={
                location.pathname.startsWith("/gestion")
                  ? "btn-primary"
                  : "btn-secondary"
              }
            >
              Gestión
            </Link>
            <Link
              to="/historial"
              className={
                location.pathname.startsWith("/historial")
                  ? "btn-primary"
                  : "btn-secondary"
              }
            >
              Historial
            </Link>
          </nav>
        </div>
      </header>

      <main className="container">
        <Outlet />
      </main>
    </div>
  );
}

function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/horarios" replace />} />
        <Route path="/horarios" element={<HorariosView />} />
        <Route path="/gestion" element={<HorariosView />} />
        <Route path="/historial" element={<HorariosView />} />
        <Route path="/trabajadores" element={<TrabajadoresView />} />
        <Route path="/trabajadores/:id" element={<TrabajadoresView />} />
        <Route path="/facturas" element={<FacturasView />} />
        <Route path="/facturas/casas/:id" element={<FacturasView />} />
        <Route path="/facturas/:id" element={<FacturaDetalleView />} />
        <Route path="*" element={<Navigate to="/horarios" replace />} />
      </Route>
    </Routes>
  );
}

export default App;
