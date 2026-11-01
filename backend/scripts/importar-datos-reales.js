#!/usr/bin/env node
"use strict";

/**
 * Fase 1 — Vista previa de la importación de datos reales.
 *
 * Lee los Excel de `datos_reales/` y genera artefactos de revisión en
 * `datos_reales/_salida/`. NO se conecta a MySQL y NO escribe nada en la BD.
 *
 * Uso:  node backend/scripts/importar-datos-reales.js
 */

const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");

const ROOT = path.resolve(__dirname, "../..");
const DIR_DATOS = path.join(ROOT, "datos_reales");
const DIR_SALIDA = path.join(DIR_DATOS, "_salida");

const F_CLIENTES = path.join(DIR_DATOS, "Clientes_CN.xlsx");
const F_TRABAJADORES = path.join(DIR_DATOS, "Trabajadores_CN.xlsx");

// ---------------------------------------------------------------------------
// Frecuencias confirmadas. `texto` se conserva siempre tal cual en BD.
// `3 SEMANA` = 3 visitas por cada 7 días (confirmado por el usuario).
// ---------------------------------------------------------------------------
const FRECUENCIAS = {
  SEMANAL: { visitas: 1, periodo: 7, nota: null },
  SEMANL: { visitas: 1, periodo: 7, nota: "Errata de SEMANAL" },
  "C/15 DIAS": { visitas: 1, periodo: 15, nota: null },
  "2 SEMANAL": { visitas: 2, periodo: 7, nota: null },
  "3D SEMANAL": { visitas: 3, periodo: 7, nota: null },
  "3 SEMANA": { visitas: 3, periodo: 7, nota: "3 visitas por semana (confirmado)" },
  "1 MES": { visitas: 1, periodo: 30, nota: null },
  OCACIONAL: { visitas: null, periodo: null, nota: "Sin periodicidad fija" },
};

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function limpiar(valor) {
  if (valor === null || valor === undefined) return null;
  const texto = String(valor)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return texto === "" ? null : texto;
}

/** Clave de comparación: sin acentos, mayúsculas, sin puntuación. */
function clave(valor) {
  return limpiar(valor)
    ? limpiar(valor)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toUpperCase()
        .replace(/[^A-Z0-9 ]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    : "";
}

function distancia(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let previa = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i += 1) {
    const actual = [i];
    for (let j = 1; j <= n; j += 1) {
      const coste = a[i - 1] === b[j - 1] ? 0 : 1;
      actual[j] = Math.min(actual[j - 1] + 1, previa[j] + 1, previa[j - 1] + coste);
    }
    previa = actual;
  }
  return previa[n];
}

function numero(valor) {
  if (valor === null || valor === undefined || valor === "") return null;
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  const texto = String(valor).replace(/\s/g, "").replace(",", ".");
  const n = Number(texto);
  return Number.isFinite(n) ? n : null;
}

function textoCelda(celda) {
  if (!celda) return null;
  const v = celda.value;
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return limpiar(v);
  if (typeof v === "number") return limpiar(String(v));
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if (Array.isArray(v.richText)) return limpiar(v.richText.map((r) => r.text).join(""));
    if (v.text !== undefined) return limpiar(String(v.text));
    if (v.result !== undefined) return limpiar(String(v.result));
  }
  return limpiar(String(v));
}

function valorCelda(celda) {
  if (!celda) return null;
  const v = celda.value;
  if (v && typeof v === "object" && !(v instanceof Date)) {
    if (v.result !== undefined) return v.result;
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join("");
  }
  return v === undefined ? null : v;
}

// ---------------------------------------------------------------------------
// Parseo de "Población": "C.P. 08470 SANT CELONI" -> { cp, municipio }
// No se corrige nada: si el CP no tiene 5 dígitos se marca la incidencia.
// ---------------------------------------------------------------------------
function parsearPoblacion(raw) {
  const texto = limpiar(raw);
  if (!texto) {
    return {
      codigo_postal: null,
      poblacion: null,
      incidencia: "Sin población ni código postal",
    };
  }

  const sinPrefijo = texto.replace(/^\s*C\s*[-.]?\s*P\.?\s*/i, "").trim();
  const coincidencia = sinPrefijo.match(/^(\d+)\s*(.*)$/);

  if (!coincidencia) {
    return {
      codigo_postal: null,
      poblacion: limpiar(sinPrefijo) || texto,
      incidencia: "Sin código postal",
    };
  }

  const digitos = coincidencia[1];
  const municipio = limpiar(coincidencia[2]);

  if (digitos.length !== 5) {
    return {
      codigo_postal: digitos,
      poblacion: municipio,
      incidencia: `Código postal con ${digitos.length} dígitos ("${digitos}")`,
    };
  }

  return { codigo_postal: digitos, poblacion: municipio, incidencia: null };
}

function normalizarTelefono(raw) {
  const texto = limpiar(raw);
  if (!texto) return { contacto: null, incidencia: null };
  const soloDigitos = texto.replace(/\D/g, "");
  const incidencia =
    soloDigitos.length === 9 ? null : `Teléfono con ${soloDigitos.length} dígitos`;
  return { contacto: soloDigitos || null, incidencia };
}

// ---------------------------------------------------------------------------
// Lectura de los Excel
// ---------------------------------------------------------------------------

async function leerHoja(ruta) {
  if (!fs.existsSync(ruta)) {
    throw new Error(`No existe el archivo: ${path.basename(ruta)}`);
  }
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.readFile(ruta);
  const hoja = libro.worksheets[0];
  const filas = [];

  hoja.eachRow({ includeEmpty: false }, (fila, numeroFila) => {
    if (numeroFila === 1) return; // cabecera
    filas.push({
      fila: numeroFila,
      celdas: {
        A: textoCelda(fila.getCell(1)),
        B: textoCelda(fila.getCell(2)),
        C: textoCelda(fila.getCell(3)),
        D: textoCelda(fila.getCell(4)),
        E: textoCelda(fila.getCell(5)),
        F: textoCelda(fila.getCell(6)),
        G: textoCelda(fila.getCell(7)),
        H: textoCelda(fila.getCell(8)),
        I: textoCelda(fila.getCell(9)),
        J: valorCelda(fila.getCell(10)),
        K: valorCelda(fila.getCell(11)),
      },
    });
  });

  return { filas, filasHoja: hoja.rowCount };
}

// ---------------------------------------------------------------------------
// Clasificación de trabajadores
// ---------------------------------------------------------------------------

function analizarTrabajadores(filas, codigosBd) {
  const trabajadores = [];
  const incidencias = [];

  for (const { fila, celdas } of filas) {
    const nombre = limpiar(celdas.A);
    const apellidos = limpiar(celdas.B);
    const codigo = limpiar(celdas.C);

    if (!codigo) {
      incidencias.push({
        fila,
        tipo: "TRABAJADOR_SIN_CODIGO",
        detalle: `Trabajador sin clave (fila ${fila})`,
      });
      continue;
    }

    const telefono = normalizarTelefono(celdas.D);
    const faltantes = [];
    if (!nombre) faltantes.push("nombre");
    if (!apellidos) faltantes.push("apellidos");
    if (!telefono.contacto) faltantes.push("contacto");
    if (!limpiar(celdas.E)) faltantes.push("direccion");
    if (!limpiar(celdas.F)) faltantes.push("poblacion");

    if (telefono.incidencia) {
      incidencias.push({
        fila,
        tipo: "TELEFONO_TRABAJADOR",
        detalle: `${telefono.incidencia} (clave ${codigo})`,
      });
    }

    const existente = codigosBd.get(codigo.toUpperCase()) || null;

    trabajadores.push({
      fila,
      origen_fila: fila,
      origen_archivo: path.basename(F_TRABAJADORES),
      codigo: codigo.toUpperCase(),
      nombre,
      apellidos,
      contacto: telefono.contacto,
      direccion: limpiar(celdas.E),
      poblacion: limpiar(celdas.F),
      accion: existente ? "ACTUALIZAR" : "INSERTAR",
      codigo_actual_en_bd: existente ? existente.codigo : null,
      nombre_actual_en_bd: existente ? existente.nombre : null,
      incompleto: faltantes.length > 0,
      datos_pendientes: faltantes.length > 0,
      campos_faltantes: faltantes,
    });
  }

  // Códigos duplicados dentro del propio Excel
  const porCodigo = new Map();
  for (const t of trabajadores) {
    if (!porCodigo.has(t.codigo)) porCodigo.set(t.codigo, []);
    porCodigo.get(t.codigo).push(t.fila);
  }
  for (const [codigo, filasCodigo] of porCodigo) {
    if (filasCodigo.length > 1) {
      incidencias.push({
        fila: filasCodigo.join(","),
        tipo: "CODIGO_DUPLICADO",
        detalle: `La clave "${codigo}" aparece ${filasCodigo.length} veces`,
      });
    }
  }

  // Códigos incompatibles con la columna actual (varchar(10))
  for (const t of trabajadores) {
    if (t.codigo.length > 10) {
      incidencias.push({
        fila: t.fila,
        tipo: "CODIGO_DEMASIADO_LARGO",
        detalle: `La clave "${t.codigo}" supera 10 caracteres`,
      });
    }
    if (!/^[A-Z0-9]+$/.test(t.codigo)) {
      incidencias.push({
        fila: t.fila,
        tipo: "CODIGO_CARACTERES_RAROS",
        detalle: `La clave "${t.codigo}" contiene caracteres no alfanuméricos`,
      });
    }
  }

  return { trabajadores, incidencias };
}

// ---------------------------------------------------------------------------
// Clasificación de clientes (casas y escaleras)
// ---------------------------------------------------------------------------

function derivarTipo(nombreHorario) {
  const n = limpiar(nombreHorario) || "";

  if (/^\s*ESC\b/i.test(n)) return { tipo: "escalera", confianza: "alta" };
  if (/^\s*C\.?\s*P\.?\b/i.test(n)) return { tipo: "escalera", confianza: "alta" };
  if (/piscina/i.test(n)) return { tipo: "piscina", confianza: "alta" };
  if (/camping/i.test(n)) return { tipo: "local", confianza: "media" };
  if (/\b(material|tienda|expo|cuines)\b/i.test(n)) {
    return { tipo: "empresa", confianza: "media" };
  }
  // El tipo describe el PUNTO de servicio, no la forma jurídica del cliente:
  // una masía propiedad de una SL sigue siendo una vivienda.
  return { tipo: "vivienda", confianza: "baja" };
}

function tieneFormaJuridica(nombreCliente) {
  return /\b(S\.?L\.?|S\.?A\.?|COMUNIDAD|C\.?\s*P\.?\s*DE\s*VEC)\b/i.test(
    limpiar(nombreCliente) || "",
  );
}

/** Busca a qué fila con datos corresponde un marcador (por calle + número). */
function resolverMarcador(nombreMarcador, candidatas) {
  const claveMarcador = clave(nombreMarcador);
  const numero = (claveMarcador.match(/\b(\d{1,4})\b/) || [])[1] || null;
  const palabras = claveMarcador
    .replace(/\bESC\b/g, " ")
    .replace(/\bC\s*P\b/g, " ")
    .split(" ")
    .filter((p) => p.length >= 4 && !/^\d+$/.test(p));

  const coincidencias = [];

  // Sin número de calle no se puede asignar con seguridad: "Vallgorguina"
  // o "Fleming" pueden ser cabeceras de sección o referencias a varios puntos.
  if (!numero) {
    return { numero: null, palabras, coincidencias: [], sinNumero: true };
  }

  for (const candidata of candidatas) {
    const direccion = clave(candidata.direccion);
    if (!direccion) continue;

    if (!new RegExp(`\\b${numero}\\b`).test(direccion)) continue;

    const calleCoincide = palabras.some((palabra) => {
      if (direccion.includes(palabra)) return true;
      return direccion
        .split(" ")
        .some((token) => token.length >= 4 && distancia(token, palabra) <= 2);
    });

    if (calleCoincide) coincidencias.push(candidata);
  }

  return { numero, palabras, coincidencias, sinNumero: false };
}

function analizarClientes(filas) {
  const registros = [];
  const incidencias = [];
  const poblaciones = new Map();

  for (const { fila, celdas } of filas) {
    const nombreHorario = limpiar(celdas.A);
    if (!nombreHorario) continue;

    const telefono = normalizarTelefono(celdas.D);
    const poblacion = parsearPoblacion(celdas.F);
    const precio = numero(celdas.J);
    const horas = numero(celdas.K);
    const frecuenciaTexto = limpiar(celdas.H);
    const frecuenciaClave = frecuenciaTexto
      ? frecuenciaTexto.toUpperCase().replace(/\s+/g, " ").trim()
      : null;
    const frecuencia = frecuenciaClave ? FRECUENCIAS[frecuenciaClave] || null : null;

    const nombreClienteCompleto =
      [limpiar(celdas.B), limpiar(celdas.C)].filter(Boolean).join(" ") || null;

    const marcador =
      !telefono.contacto &&
      !limpiar(celdas.E) &&
      precio === null &&
      horas === null &&
      !frecuenciaTexto;

    const tipoInicial = derivarTipo(nombreHorario);

    registros.push({
      fila,
      origen_fila: fila,
      origen_archivo: path.basename(F_CLIENTES),
      nombre_horario: nombreHorario,
      nombre: limpiar(celdas.B),
      apellidos: limpiar(celdas.C),
      nombre_cliente: nombreClienteCompleto,
      contacto: telefono.contacto,
      direccion: limpiar(celdas.E),
      codigo_postal: poblacion.codigo_postal,
      poblacion: poblacion.poblacion,
      poblacion_raw: limpiar(celdas.F),
      emite_factura: /x/i.test(limpiar(celdas.G) || "") ? 1 : 0,
      factura_marcada: Boolean(limpiar(celdas.G)),
      frecuencia_texto: frecuenciaTexto,
      frecuencia_clave: frecuenciaClave,
      visitas_por_periodo: frecuencia ? frecuencia.visitas : null,
      periodo_dias: frecuencia ? frecuencia.periodo : null,
      sobre_nombre: limpiar(celdas.I),
      precio_hora: precio,
      horas_referencia: horas,
      duracion_referencia_minutos: horas === null ? null : Math.round(horas * 60),
      tipo: tipoInicial.tipo,
      tipo_confianza: tipoInicial.confianza,
      es_marcador: marcador,
      incidencias: [],
    });

    // Los marcadores ya tienen su propio motivo de exclusión: no se les
    // generan incidencias de datos para no duplicar ruido en el informe.
    if (!marcador) {
      if (telefono.incidencia) {
        registros[registros.length - 1].incidencias.push(telefono.incidencia);
      }
      if (poblacion.incidencia) {
        registros[registros.length - 1].incidencias.push(poblacion.incidencia);
      }
      if (
        !poblacion.codigo_postal &&
        /C\.?\s*P\.?\s*[0-9O]/i.test(limpiar(celdas.E) || "")
      ) {
        registros[registros.length - 1].incidencias.push(
          "La dirección parece contener el código postal; revisar",
        );
      }
      if (frecuenciaTexto && !frecuencia) {
        registros[registros.length - 1].incidencias.push(
          `Frecuencia no reconocida: "${frecuenciaTexto}"`,
        );
      }
      if (tipoInicial.tipo === "vivienda" && tieneFormaJuridica(nombreClienteCompleto)) {
        registros[registros.length - 1].incidencias.push(
          "El cliente tiene forma jurídica (SL/SA/comunidad): confirmar si el punto es vivienda o empresa",
        );
      }
      if (limpiar(celdas.G) && !/x/i.test(limpiar(celdas.G))) {
        registros[registros.length - 1].incidencias.push(
          `Valor inesperado en "Factura": "${limpiar(celdas.G)}"`,
        );
      }

      // Las incidencias del registro también se acumulan en el informe global.
      for (const detalle of registros[registros.length - 1].incidencias) {
        incidencias.push({ fila, tipo: "DATO_REGISTRO", detalle });
      }
    }

    if (frecuencia && frecuencia.nota) {
      registros[registros.length - 1].frecuencia_nota = frecuencia.nota;
    }

    if (poblacion.codigo_postal || poblacion.poblacion) {
      const k = `${poblacion.codigo_postal || "?"} | ${poblacion.poblacion || "?"}`;
      poblaciones.set(k, (poblaciones.get(k) || 0) + 1);
    }
  }

  // -------------------------------------------------------------------------
  // 1. Todos los registros de origen se importan como registros independientes.
  //    Nada se fusiona, nada se excluye y nada se convierte en alias.
  // -------------------------------------------------------------------------
  for (const registro of registros) {
    registro.estado = "IMPORTAR";
    registro.motivo = "Registro de origen importado como registro independiente.";
    registro.requiere_revision = false;
    registro.posible_alias_de = [];
    registro.posible_duplicado_de = [];
    registro.misma_direccion_que = [];
  }

  const conDatos = registros.filter((r) => !r.es_marcador);
  const marcadores = registros.filter((r) => r.es_marcador);

  // -------------------------------------------------------------------------
  // 2. Registros con muy poca información (solo un nombre). Se importan igual:
  //    solo se anota a qué fila podrían referirse, como ayuda de revisión.
  // -------------------------------------------------------------------------
  for (const marcador of marcadores) {
    const { numero, palabras, coincidencias } = resolverMarcador(
      marcador.nombre_horario,
      conDatos,
    );

    marcador.numero_detectado = numero;
    marcador.palabras_detectadas = palabras;
    marcador.posible_alias_de = coincidencias.map((c) => c.fila);
    marcador.requiere_revision = true;
    // No se puede deducir el tipo: queda NULL (sin clasificar), no "vivienda".
    marcador.tipo = null;
    marcador.tipo_confianza = null;

    if (coincidencias.length === 1) {
      marcador.motivo =
        `Registro con muy poca información. Podría referirse a la fila ${coincidencias[0].fila} ` +
        "(misma calle y número), pero se importa como registro independiente.";
    } else if (coincidencias.length > 1) {
      marcador.motivo =
        "Registro con muy poca información. Podría referirse a varias filas " +
        `(${coincidencias.map((c) => c.fila).join(", ")}). Se importa como registro independiente.`;
    } else {
      marcador.motivo =
        "Registro con muy poca información: se importa igualmente y queda pendiente " +
        "de completar desde la aplicación.";
    }

    incidencias.push({
      fila: marcador.fila,
      tipo: "REGISTRO_CON_POCA_INFORMACION",
      detalle:
        `"${marcador.nombre_horario}" no tiene contacto, dirección, precio, duración ni frecuencia. ` +
        "Se importa como registro independiente y se marca como pendiente de completar.",
    });
  }

  // -------------------------------------------------------------------------
  // 3. Posibles duplicados: solo se informa. No se fusionan ni se descartan.
  // -------------------------------------------------------------------------
  const porDireccion = new Map();
  for (const registro of conDatos) {
    const k = clave(registro.direccion);
    if (!k) continue;
    if (!porDireccion.has(k)) porDireccion.set(k, []);
    porDireccion.get(k).push(registro);
  }

  for (const grupo of porDireccion.values()) {
    if (grupo.length < 2) continue;

    const firma = (r) =>
      [
        clave(r.nombre_cliente),
        r.contacto,
        r.precio_hora,
        r.horas_referencia,
        clave(r.frecuencia_texto),
      ].join("|");

    const firmas = new Set(grupo.map(firma));
    const mismosDatos = firmas.size === 1;

    for (const registro of grupo) {
      const otros = grupo.filter((r) => r !== registro);
      registro.misma_direccion_que = otros.map((r) => r.fila);
      registro.posible_duplicado_de = mismosDatos ? otros.map((r) => r.fila) : [];
      registro.requiere_revision = true;
      registro.motivo +=
        ` Comparte dirección con la(s) fila(s) ${otros.map((r) => r.fila).join(", ")}; ` +
        "se importa como registro independiente.";
    }

    incidencias.push({
      fila: grupo.map((r) => r.fila).join(","),
      tipo: mismosDatos ? "POSIBLE_DUPLICADO" : "MISMA_DIRECCION_DISTINTOS_DATOS",
      detalle: mismosDatos
        ? `Las filas ${grupo.map((r) => r.fila).join(", ")} tienen la misma dirección y los mismos datos. ` +
          "Se importan como registros independientes (no se fusionan)."
        : `Las filas ${grupo.map((r) => r.fila).join(", ")} comparten dirección pero no datos. ` +
          "Se importan como registros independientes (no se unifican).",
    });
  }

  // -------------------------------------------------------------------------
  // 4. Campos que faltan y marca de pendiente (para TODOS los registros)
  // -------------------------------------------------------------------------
  const CRITICOS = [
    "nombre_cliente",
    "contacto",
    "direccion",
    "frecuencia",
    "precio_hora",
    "duracion_referencia",
  ];

  for (const registro of registros) {
    const faltantes = [];
    if (!registro.nombre_cliente) faltantes.push("nombre_cliente");
    if (!registro.contacto) faltantes.push("contacto");
    if (!registro.direccion) faltantes.push("direccion");
    if (!registro.codigo_postal) faltantes.push("codigo_postal");
    if (!registro.poblacion) faltantes.push("poblacion");
    if (registro.frecuencia_texto === null) faltantes.push("frecuencia");
    if (registro.precio_hora === null) faltantes.push("precio_hora");
    if (registro.horas_referencia === null) faltantes.push("duracion_referencia");
    if (!registro.sobre_nombre) faltantes.push("alias_sobrenombre");
    if (!registro.tipo) faltantes.push("tipo");

    // "incompleto" = falta un dato necesario para operar o facturar.
    // "datos_pendientes" = falta cualquier dato, incluidos los secundarios.
    registro.campos_faltantes = faltantes;
    registro.campos_faltantes_criticos = faltantes.filter((f) => CRITICOS.includes(f));
    registro.datos_secundarios_faltantes = faltantes.filter((f) => !CRITICOS.includes(f));
    registro.incompleto = registro.campos_faltantes_criticos.length > 0;
    registro.datos_pendientes = faltantes.length > 0;

    if (registro.datos_pendientes) {
      registro.motivo +=
        " Se importa con NULL en los campos que faltan y se marca como pendiente de completar.";
    }
  }

  return { registros, incidencias, poblaciones };
}

// ---------------------------------------------------------------------------
// Alias
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Alias sugeridos
//
// Se generan SOLO como propuesta para el futuro. No se aplican en la
// importación: los 100 registros de origen se crean por separado y ningún
// registro se convierte en alias de otro.
// ---------------------------------------------------------------------------

function construirAlias(registros) {
  const alias = [];

  const agregar = (registro, valor, tipo, aplicado = false) => {
    const limpio = limpiar(valor);
    if (!limpio) return;
    if (clave(limpio) === clave(registro.nombre_horario)) return;
    if (
      alias.some(
        (a) => a.casa_fila === registro.fila && clave(a.alias) === clave(limpio),
      )
    ) {
      return;
    }
    alias.push({
      casa_fila: registro.fila,
      casa_nombre: registro.nombre_horario,
      alias: limpio,
      tipo,
      aplicado,
      ambiguo: false,
      num_puntos: 1,
    });
  };

  for (const registro of registros) {
    agregar(registro, registro.nombre_cliente, "cliente");
    agregar(registro, registro.sobre_nombre, "sobrenombre");
  }

  // Nombres de registros con poca información que podrían referirse a otro
  // registro: se proponen como alias, sin aplicarlos.
  for (const registro of registros) {
    if (!registro.posible_alias_de || registro.posible_alias_de.length === 0) continue;
    for (const filaDestino of registro.posible_alias_de) {
      const destino = registros.find((r) => r.fila === filaDestino);
      if (!destino) continue;
      agregar(destino, registro.nombre_horario, "horario_sugerido");
    }
  }

  // Ambigüedad: un alias propuesto que apunta a más de un punto de servicio.
  const porAlias = new Map();
  for (const a of alias) {
    const k = clave(a.alias);
    if (!porAlias.has(k)) porAlias.set(k, new Set());
    porAlias.get(k).add(a.casa_fila);
  }
  for (const a of alias) {
    const destinos = porAlias.get(clave(a.alias));
    a.ambiguo = destinos.size > 1;
    a.num_puntos = destinos.size;
  }

  return alias;
}

// ---------------------------------------------------------------------------
// Salidas
// ---------------------------------------------------------------------------

function escaparCsv(valor) {
  if (valor === null || valor === undefined) return "";
  const texto = String(valor);
  return /[";\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

function escribirCsv(ruta, cabecera, filas) {
  const lineas = [cabecera.join(";")];
  for (const fila of filas) {
    lineas.push(cabecera.map((c) => escaparCsv(fila[c])).join(";"));
  }
  fs.writeFileSync(ruta, `\uFEFF${lineas.join("\r\n")}\r\n`, "utf8");
}

function escaparHtml(valor) {
  if (valor === null || valor === undefined) return "";
  return String(valor)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function tablaHtml(filas, columnas) {
  if (filas.length === 0) return "<p class='vacio'>Sin registros.</p>";
  const cabecera = columnas.map((c) => `<th>${escaparHtml(c.titulo)}</th>`).join("");
  const cuerpo = filas
    .map(
      (fila) =>
        `<tr>${columnas
          .map((c) => `<td>${escaparHtml(c.valor(fila))}</td>`)
          .join("")}</tr>`,
    )
    .join("\n");
  return `<table><thead><tr>${cabecera}</tr></thead><tbody>${cuerpo}</tbody></table>`;
}

function generarHtml({ registros, alias, trabajadores, incidencias, resumen }) {
  const importar = registros;
  const incompletos = registros.filter((r) => r.incompleto);
  const pendientes = registros.filter((r) => r.datos_pendientes);
  const posiblesDuplicados = registros.filter(
    (r) => (r.posible_duplicado_de || []).length > 0,
  );
  const pocaInformacion = registros.filter((r) => r.es_marcador);

  const columnasCasas = [
    { titulo: "Fila", valor: (r) => r.fila },
    { titulo: "Nombre horario", valor: (r) => r.nombre_horario },
    { titulo: "Cliente", valor: (r) => r.nombre_cliente },
    { titulo: "Dirección", valor: (r) => r.direccion },
    { titulo: "CP", valor: (r) => r.codigo_postal },
    { titulo: "Población", valor: (r) => r.poblacion },
    { titulo: "Tipo", valor: (r) => r.tipo || "sin clasificar" },
    { titulo: "Frecuencia", valor: (r) => r.frecuencia_texto },
    { titulo: "Visitas/periodo", valor: (r) => r.visitas_por_periodo },
    { titulo: "Días", valor: (r) => r.periodo_dias },
    { titulo: "€/h", valor: (r) => r.precio_hora },
    { titulo: "Horas ref.", valor: (r) => r.horas_referencia },
    { titulo: "Min. ref.", valor: (r) => r.duracion_referencia_minutos },
    { titulo: "Factura", valor: (r) => (r.emite_factura ? "Sí" : "No") },
    { titulo: "Sobrenombre", valor: (r) => r.sobre_nombre },
    { titulo: "Nota frecuencia", valor: (r) => r.frecuencia_nota },
    { titulo: "Pendiente", valor: (r) => (r.datos_pendientes ? "Sí" : "No") },
    { titulo: "Faltan (crítico)", valor: (r) => (r.campos_faltantes_criticos || []).join(", ") },
    { titulo: "Faltan (secundario)", valor: (r) => (r.datos_secundarios_faltantes || []).join(", ") },
    { titulo: "Motivo", valor: (r) => r.motivo },
  ];

  const columnasRevision = [
    { titulo: "Fila", valor: (r) => r.fila },
    { titulo: "Nombre horario", valor: (r) => r.nombre_horario },
    { titulo: "Cliente", valor: (r) => r.nombre_cliente },
    { titulo: "Dirección", valor: (r) => r.direccion },
    { titulo: "Posible duplicado de (filas)", valor: (r) => (r.posible_duplicado_de || []).join(", ") },
    { titulo: "Misma dirección que (filas)", valor: (r) => (r.misma_direccion_que || []).join(", ") },
    { titulo: "Podría referirse a (filas)", valor: (r) => (r.posible_alias_de || []).join(", ") },
    { titulo: "Se importa", valor: () => "Sí, como registro independiente" },
    { titulo: "Motivo", valor: (r) => r.motivo },
  ];

  const columnasTrabajadores = [
    { titulo: "Fila", valor: (t) => t.fila },
    { titulo: "Clave", valor: (t) => t.codigo },
    { titulo: "Nombre", valor: (t) => t.nombre },
    { titulo: "Apellidos", valor: (t) => t.apellidos },
    { titulo: "Contacto", valor: (t) => t.contacto },
    { titulo: "Población", valor: (t) => t.poblacion },
    { titulo: "Acción", valor: (t) => t.accion },
    { titulo: "Faltan", valor: (t) => (t.campos_faltantes || []).join(", ") },
  ];

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Vista previa de importación — horarios-app</title>
<style>
  :root { color-scheme: light; }
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0; padding: 24px; background: #f6f7f9; color: #1d2330; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 17px; margin: 32px 0 8px; }
  .sub { color: #5a6478; font-size: 13px; margin-bottom: 20px; }
  .aviso { background: #fff4e5; border: 1px solid #f0c27a; padding: 10px 14px; border-radius: 8px; font-size: 13px; margin-bottom: 18px; }
  .kpis { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 8px; }
  .kpi { background: #fff; border: 1px solid #dfe3ea; border-radius: 10px; padding: 10px 14px; min-width: 130px; }
  .kpi b { display: block; font-size: 22px; }
  .kpi span { font-size: 12px; color: #5a6478; }
  table { border-collapse: collapse; width: 100%; background: #fff; font-size: 12px; }
  th, td { border: 1px solid #e3e7ee; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background: #eef1f6; position: sticky; top: 0; font-size: 11px; text-transform: uppercase; letter-spacing: .02em; }
  tbody tr:nth-child(even) { background: #fafbfd; }
  .badge { display: inline-block; padding: 2px 7px; border-radius: 999px; font-size: 11px; font-weight: 600; }
  .b-ok { background: #e3f6e9; color: #1d6b35; }
  .b-warn { background: #fff2d9; color: #8a5a00; }
  .b-err { background: #fde5e5; color: #8f1f1f; }
  .vacio { color: #5a6478; font-size: 13px; }
  input[type=search] { padding: 7px 10px; border: 1px solid #cfd5e0; border-radius: 8px; width: 280px; margin-bottom: 8px; }
  .filtro { margin-bottom: 6px; }
</style>
</head>
<body>
<h1>Vista previa de importación — horarios-app</h1>
<p class="sub">Generada por <code>backend/scripts/importar-datos-reales.js</code>. No se ha escrito nada en MySQL.</p>
<div class="aviso">
  Este archivo contiene datos personales (nombres, teléfonos, direcciones).
  Está dentro de <code>datos_reales/</code>, que está excluido de Git. No lo compartas.
</div>
<div class="aviso">
  <strong>Regla de esta importación:</strong> los ${registros.length} registros de origen se importan
  como registros independientes. No se fusiona ninguno, ninguno se convierte en alias de otro
  y ninguno se excluye por estar incompleto. Los alias de la sección 7 son solo propuestas.
</div>

<div class="kpis">
  <div class="kpi"><b>${resumen.filas_hoja}</b><span>filas en el Excel</span></div>
  <div class="kpi"><b>${resumen.filas_cabecera}</b><span>fila de cabecera</span></div>
  <div class="kpi"><b>${importar.length}</b><span>registros a importar</span></div>
  <div class="kpi"><b>${pendientes.length}</b><span>pendientes de completar</span></div>
  <div class="kpi"><b>${incompletos.length}</b><span>con dato crítico ausente</span></div>
  <div class="kpi"><b>${posiblesDuplicados.length}</b><span>posibles duplicados (sin fusionar)</span></div>
  <div class="kpi"><b>${pocaInformacion.length}</b><span>con muy poca información</span></div>
  <div class="kpi"><b>${alias.length}</b><span>alias sugeridos (0 aplicados)</span></div>
  <div class="kpi"><b>${trabajadores.length}</b><span>trabajadores</span></div>
  <div class="kpi"><b>${incidencias.length}</b><span>incidencias</span></div>
</div>

<h2>1. Conciliación de filas del Excel</h2>
<p class="sub">
  El archivo tiene ${resumen.filas_hoja} filas: 1 cabecera + ${registros.length} registros de cliente.
  Todas las filas quedan contabilizadas; no se omite ninguna.
</p>
<table>
  <thead><tr><th>Concepto</th><th>Filas</th></tr></thead>
  <tbody>
    <tr><td>Filas totales de la hoja</td><td>${resumen.filas_hoja}</td></tr>
    <tr><td>Fila 1: cabecera (no es un cliente)</td><td>${resumen.filas_cabecera}</td></tr>
    <tr><td>Filas 2 a ${resumen.filas_hoja}: registros de cliente</td><td>${registros.length}</td></tr>
    <tr><td>Registros importados como independientes</td><td>${importar.length}</td></tr>
    <tr><td>Registros fusionados</td><td>0</td></tr>
    <tr><td>Registros convertidos en alias</td><td>0</td></tr>
    <tr><td>Registros excluidos</td><td>0</td></tr>
  </tbody>
</table>

<h2>2. Todos los registros de origen (${importar.length})</h2>
<p class="sub">Cada fila se convierte en un registro propio, con su fila de origen para poder auditarla.</p>
<div class="filtro"><input type="search" data-tabla="t-importar" placeholder="Filtrar…"></div>
<div id="t-importar">${tablaHtml(importar, columnasCasas)}</div>

<h2>3. Pendientes de completar (${pendientes.length})</h2>
<p class="sub">Les falta algún dato (crítico o secundario). Se importan con <code>NULL</code> y quedan marcados para completarlos desde la aplicación.</p>
<div class="filtro"><input type="search" data-tabla="t-pendientes" placeholder="Filtrar…"></div>
<div id="t-pendientes">${tablaHtml(pendientes, columnasCasas)}</div>

<h2>4. Con dato crítico ausente (${incompletos.length})</h2>
<p class="sub">Falta nombre de cliente, contacto, dirección, frecuencia, precio/hora o duración de referencia. Se importan igualmente.</p>
<div class="filtro"><input type="search" data-tabla="t-incompletos" placeholder="Filtrar…"></div>
<div id="t-incompletos">${tablaHtml(incompletos, columnasCasas)}</div>

<h2>5. Posibles duplicados — solo informativo, NO se fusionan (${posiblesDuplicados.length})</h2>
<p class="sub">Misma dirección y mismos datos. Se importan como registros separados; si más adelante quieres unificarlos, se hará desde la aplicación, nunca automáticamente.</p>
<div class="filtro"><input type="search" data-tabla="t-duplicados" placeholder="Filtrar…"></div>
<div id="t-duplicados">${tablaHtml(posiblesDuplicados, columnasRevision)}</div>

<h2>6. Registros con muy poca información — se importan igual (${pocaInformacion.length})</h2>
<p class="sub">Solo tienen un nombre. No se excluyen: se crean como registros propios y quedan pendientes de completar.</p>
<div class="filtro"><input type="search" data-tabla="t-poca" placeholder="Filtrar…"></div>
<div id="t-poca">${tablaHtml(pocaInformacion, columnasRevision)}</div>

<h2>7. Alias sugeridos — NO se aplican en esta importación (${alias.length})</h2>
<p class="sub">Propuesta para el futuro. Ningún registro se sustituye por un alias. Los ambiguos apuntan a varios registros (por ejemplo <code>ESC</code>) y siempre exigirán elegir candidato.</p>
<div class="filtro"><input type="search" data-tabla="t-alias" placeholder="Filtrar…"></div>
<div id="t-alias">${tablaHtml(
    alias,
    [
      { titulo: "Registro", valor: (a) => a.casa_nombre },
      { titulo: "Fila", valor: (a) => a.casa_fila },
      { titulo: "Alias propuesto", valor: (a) => a.alias },
      { titulo: "Tipo", valor: (a) => a.tipo },
      { titulo: "Ambiguo", valor: (a) => (a.ambiguo ? `Sí (${a.num_puntos} registros)` : "No") },
      { titulo: "Aplicado", valor: (a) => (a.aplicado ? "Sí" : "No") },
    ],
  )}</div>

<h2>8. Trabajadores (${trabajadores.length})</h2>
<div class="filtro"><input type="search" data-tabla="t-trab" placeholder="Filtrar…"></div>
<div id="t-trab">${tablaHtml(trabajadores, columnasTrabajadores)}</div>

<h2>9. Incidencias (${incidencias.length})</h2>
<div class="filtro"><input type="search" data-tabla="t-inc" placeholder="Filtrar…"></div>
<div id="t-inc">${tablaHtml(incidencias, [
    { titulo: "Fila", valor: (i) => i.fila },
    { titulo: "Tipo", valor: (i) => i.tipo },
    { titulo: "Detalle", valor: (i) => i.detalle },
  ])}</div>

<script>
  document.querySelectorAll("input[type=search]").forEach((input) => {
    input.addEventListener("input", () => {
      const texto = input.value.toLowerCase();
      const contenedor = document.getElementById(input.dataset.tabla);
      contenedor.querySelectorAll("tbody tr").forEach((fila) => {
        fila.style.display = fila.textContent.toLowerCase().includes(texto) ? "" : "none";
      });
    });
  });
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!fs.existsSync(DIR_DATOS)) {
    throw new Error("No existe la carpeta datos_reales/");
  }
  fs.mkdirSync(DIR_SALIDA, { recursive: true });

  // Códigos de trabajador que ya existen en la BD (solo para clasificar la acción).
  // Se leen del dump si está disponible; si no, se deja vacío y todo sería INSERTAR.
  let codigosBd = new Map();
  const rutaCodigos = path.join(DIR_SALIDA, "codigos_bd.json");
  if (fs.existsSync(rutaCodigos)) {
    const datos = JSON.parse(fs.readFileSync(rutaCodigos, "utf8"));
    codigosBd = new Map(datos.map((t) => [t.codigo.toUpperCase(), t]));
  }

  const lecturaClientes = await leerHoja(F_CLIENTES);
  const lecturaTrabajadores = await leerHoja(F_TRABAJADORES);
  const filasClientes = lecturaClientes.filas;
  const filasTrabajadores = lecturaTrabajadores.filas;

  const trabajadoresAnalisis = analizarTrabajadores(filasTrabajadores, codigosBd);
  const clientesAnalisis = analizarClientes(filasClientes);
  const alias = construirAlias(clientesAnalisis.registros);

  // Trabajadores que existen en la BD y no aparecen en el Excel: en Fase 3 se
  // desactivarán (activo = 0), nunca se borrarán, para no romper el historial.
  const codigosExcel = new Set(
    trabajadoresAnalisis.trabajadores.map((t) => t.codigo.toUpperCase()),
  );
  const trabajadoresAusentes = [...codigosBd.values()]
    .filter((t) => !codigosExcel.has(String(t.codigo).toUpperCase()))
    .map((t) => ({ id: t.id, codigo: t.codigo, nombre: t.nombre, activo: t.activo }));

  const registros = clientesAnalisis.registros;
  const importar = registros;
  const pendientes = registros.filter((r) => r.datos_pendientes);
  const incompletos = registros.filter((r) => r.incompleto);
  const posiblesDuplicados = registros.filter(
    (r) => (r.posible_duplicado_de || []).length > 0,
  );
  const pocaInformacion = registros.filter((r) => r.es_marcador);

  const resumen = {
    generado_en: new Date().toISOString(),
    archivos: {
      clientes: path.basename(F_CLIENTES),
      trabajadores: path.basename(F_TRABAJADORES),
    },
    filas_hoja: lecturaClientes.filasHoja,
    filas_cabecera: lecturaClientes.filasHoja - filasClientes.length,
    registros_origen: registros.length,
    filas_trabajadores: filasTrabajadores.length,
    puntos_importar: importar.length,
    puntos_pendientes: pendientes.length,
    puntos_incompletos: incompletos.length,
    posibles_duplicados: posiblesDuplicados.length,
    registros_poca_informacion: pocaInformacion.length,
    registros_fusionados: 0,
    filas_alias: 0,
    filas_excluidas: 0,
    alias_sugeridos: alias.length,
    alias_aplicados: 0,
    alias_ambiguos: alias.filter((a) => a.ambiguo).length,
    trabajadores_total: trabajadoresAnalisis.trabajadores.length,
    trabajadores_insertar: trabajadoresAnalisis.trabajadores.filter((t) => t.accion === "INSERTAR").length,
    trabajadores_actualizar: trabajadoresAnalisis.trabajadores.filter((t) => t.accion === "ACTUALIZAR").length,
    incidencias: clientesAnalisis.incidencias.length + trabajadoresAnalisis.incidencias.length,
  };

  // --- JSON completo ---
  fs.writeFileSync(
    path.join(DIR_SALIDA, "vista_previa.json"),
    JSON.stringify(
      {
        resumen,
        registros,
        alias,
        trabajadores: trabajadoresAnalisis.trabajadores,
        trabajadores_ausentes: trabajadoresAusentes,
        incidencias: [...clientesAnalisis.incidencias, ...trabajadoresAnalisis.incidencias],
        poblaciones: [...clientesAnalisis.poblaciones.entries()].sort((a, b) => b[1] - a[1]),
      },
      null,
      2,
    ),
    "utf8",
  );

  // --- CSV: todos los registros de origen (sin fusiones ni exclusiones) ---
  escribirCsv(
    path.join(DIR_SALIDA, "01_puntos_a_importar.csv"),
    [
      "origen_archivo",
      "origen_fila",
      "nombre_horario",
      "nombre",
      "apellidos",
      "nombre_cliente",
      "contacto",
      "direccion",
      "codigo_postal",
      "poblacion",
      "poblacion_raw",
      "tipo",
      "tipo_confianza",
      "frecuencia_texto",
      "frecuencia_nota",
      "visitas_por_periodo",
      "periodo_dias",
      "precio_hora",
      "horas_referencia",
      "duracion_referencia_minutos",
      "emite_factura",
      "alias_sobrenombre",
      "datos_pendientes",
      "incompleto",
      "campos_faltantes_criticos",
      "datos_secundarios_faltantes",
      "campos_faltantes",
      "posible_duplicado_de",
      "misma_direccion_que",
      "posible_alias_de",
      "motivo",
    ],
    importar.map((r) => ({
      ...r,
      tipo: r.tipo || "sin_clasificar",
      emite_factura: r.emite_factura ? "si" : "no",
      datos_pendientes: r.datos_pendientes ? "si" : "no",
      incompleto: r.incompleto ? "si" : "no",
      campos_faltantes: (r.campos_faltantes || []).join(", "),
      campos_faltantes_criticos: (r.campos_faltantes_criticos || []).join(", "),
      datos_secundarios_faltantes: (r.datos_secundarios_faltantes || []).join(", "),
      posible_duplicado_de: (r.posible_duplicado_de || []).join(", "),
      misma_direccion_que: (r.misma_direccion_que || []).join(", "),
      posible_alias_de: (r.posible_alias_de || []).join(", "),
    })),
  );

  // --- CSV: pendientes de completar ---
  escribirCsv(
    path.join(DIR_SALIDA, "02_incompletos.csv"),
    [
      "origen_fila",
      "nombre_horario",
      "nombre_cliente",
      "contacto",
      "direccion",
      "poblacion",
      "frecuencia_texto",
      "precio_hora",
      "horas_referencia",
      "tipo",
      "datos_pendientes",
      "incompleto",
      "campos_faltantes_criticos",
      "datos_secundarios_faltantes",
      "motivo",
      "incidencias",
    ],
    pendientes.map((r) => ({
      ...r,
      tipo: r.tipo || "sin_clasificar",
      datos_pendientes: "si",
      incompleto: r.incompleto ? "si" : "no",
      campos_faltantes_criticos: (r.campos_faltantes_criticos || []).join(", "),
      datos_secundarios_faltantes: (r.datos_secundarios_faltantes || []).join(", "),
      incidencias: (r.incidencias || []).join(" | "),
    })),
  );

  // --- CSV: alias sugeridos (NO aplicados) ---
  escribirCsv(
    path.join(DIR_SALIDA, "03_alias.csv"),
    ["casa_fila", "casa_nombre", "alias", "tipo", "ambiguo", "num_puntos", "aplicado"],
    alias.map((a) => ({
      ...a,
      ambiguo: a.ambiguo ? "si" : "no",
      aplicado: a.aplicado ? "si" : "no",
    })),
  );

  // --- CSV: posibles duplicados (informativos, no se fusionan) ---
  escribirCsv(
    path.join(DIR_SALIDA, "04_posibles_duplicados.csv"),
    [
      "origen_fila",
      "nombre_horario",
      "nombre_cliente",
      "direccion",
      "posible_duplicado_de",
      "misma_direccion_que",
      "motivo",
    ],
    registros
      .filter((r) => (r.misma_direccion_que || []).length > 0)
      .map((r) => ({
        ...r,
        posible_duplicado_de: (r.posible_duplicado_de || []).join(", "),
        misma_direccion_que: (r.misma_direccion_que || []).join(", "),
      })),
  );

  // --- CSV: registros con muy poca información (se importan igual) ---
  escribirCsv(
    path.join(DIR_SALIDA, "05_poca_informacion.csv"),
    ["origen_fila", "nombre_horario", "posible_alias_de", "campos_faltantes", "motivo"],
    pocaInformacion.map((r) => ({
      ...r,
      posible_alias_de: (r.posible_alias_de || []).join(", "),
      campos_faltantes: (r.campos_faltantes || []).join(", "),
    })),
  );

  // --- CSV: trabajadores ---
  escribirCsv(
    path.join(DIR_SALIDA, "06_trabajadores.csv"),
    ["origen_archivo", "origen_fila", "codigo", "nombre", "apellidos", "contacto", "direccion", "poblacion", "accion", "incompleto", "campos_faltantes"],
    trabajadoresAnalisis.trabajadores.map((t) => ({
      ...t,
      incompleto: t.incompleto ? "si" : "no",
      campos_faltantes: (t.campos_faltantes || []).join(", "),
    })),
  );

  // --- CSV: incidencias ---
  escribirCsv(
    path.join(DIR_SALIDA, "07_incidencias.csv"),
    ["fila", "tipo", "detalle"],
    [...clientesAnalisis.incidencias, ...trabajadoresAnalisis.incidencias],
  );

  // --- CSV: trabajadores de la BD que no están en el Excel ---
  escribirCsv(
    path.join(DIR_SALIDA, "09_trabajadores_ausentes.csv"),
    ["id", "codigo", "nombre", "activo"],
    trabajadoresAusentes,
  );

  // --- CSV: poblaciones (para normalizar después) ---
  escribirCsv(
    path.join(DIR_SALIDA, "08_poblaciones.csv"),
    ["codigo_postal_y_poblacion", "num_registros"],
    [...clientesAnalisis.poblaciones.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => ({ codigo_postal_y_poblacion: k, num_registros: n })),
  );

  // --- HTML ---
  fs.writeFileSync(
    path.join(DIR_SALIDA, "vista_previa.html"),
    generarHtml({
      registros,
      alias,
      trabajadores: trabajadoresAnalisis.trabajadores,
      incidencias: [...clientesAnalisis.incidencias, ...trabajadoresAnalisis.incidencias],
      resumen,
    }),
    "utf8",
  );

  // --- Consola: solo agregados, sin datos personales ---
  console.log("Vista previa generada en datos_reales/_salida/");
  console.log(`  Filas del Excel:        ${resumen.filas_hoja} (1 cabecera + ${resumen.registros_origen} registros)`);
  console.log(`  Registros a importar:   ${resumen.puntos_importar}`);
  console.log(`    pendientes:           ${resumen.puntos_pendientes}`);
  console.log(`    con crítico ausente:  ${resumen.puntos_incompletos}`);
  console.log(`    con poca información: ${resumen.registros_poca_informacion}`);
  console.log(`  Posibles duplicados:    ${resumen.posibles_duplicados} (sin fusionar)`);
  console.log(`  Fusionados / alias:     ${resumen.registros_fusionados} / ${resumen.filas_alias}`);
  console.log(`  Excluidos:              ${resumen.filas_excluidas}`);
  console.log(`  Alias sugeridos:        ${resumen.alias_sugeridos} (aplicados: ${resumen.alias_aplicados}, ambiguos: ${resumen.alias_ambiguos})`);
  console.log(`  Trabajadores:           ${resumen.trabajadores_total} (insertar ${resumen.trabajadores_insertar}, actualizar ${resumen.trabajadores_actualizar})`);
  console.log(`  Incidencias:            ${resumen.incidencias}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Error generando la vista previa:", error.message);
    process.exit(1);
  });
}

// El ejecutor de la importación inicial (03-importar-inicial.js) reutiliza
// exactamente este parser para que la vista previa y la importación no puedan
// divergir.
module.exports = {
  F_CLIENTES,
  F_TRABAJADORES,
  FRECUENCIAS,
  analizarClientes,
  analizarTrabajadores,
  construirAlias,
  leerHoja,
};
