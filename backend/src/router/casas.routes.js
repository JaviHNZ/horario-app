const express = require("express");
const db = require("../config/db");

const router = express.Router();

const TIPOS_SERVICIO = ["vivienda", "escalera", "empresa", "piscina", "local", "otro"];

const COLUMNAS_CASA = `
    id,
    nombre,
    nombre_cliente,
    apellidos_cliente,
    direccion,
    contacto,
    codigo_postal,
    poblacion,
    tipo,
    frecuencia_texto,
    visitas_por_periodo,
    periodo_dias,
    precio_hora,
    duracion_minutos,
    emite_factura,
    observaciones,
    datos_pendientes,
    activo,
    fecha_creacion,
    fecha_actualizacion
`;

const CAMPOS_TEXTO = [
    ["nombre_cliente", 150],
    ["apellidos_cliente", 150],
    ["direccion", 255],
    ["contacto", 20],
    ["codigo_postal", 10],
    ["poblacion", 100],
    ["frecuencia_texto", 50],
    ["observaciones", 2000]
];

// Campos que debe tener una casa para considerarse completa.
const CAMPOS_OBLIGATORIOS = [
    ["nombre_cliente", "Cliente"],
    ["contacto", "Contacto"],
    ["direccion", "Dirección"],
    ["frecuencia_texto", "Frecuencia"],
    ["precio_hora", "Precio por hora"],
    ["duracion_minutos", "Duración de referencia"]
];

function textoOpcional(valor, maximo) {
    if (valor === null || valor === undefined) return { valor: null };

    const limpio = String(valor).trim();
    if (!limpio) return { valor: null };

    if (limpio.length > maximo) {
        return { error: `no puede superar ${maximo} caracteres` };
    }

    return { valor: limpio };
}

function enteroOpcional(valor, { min, max, etiqueta }) {
    if (valor === null || valor === undefined || valor === "") {
        return { valor: null };
    }

    const numero = Number(valor);

    if (!Number.isInteger(numero) || numero < min || numero > max) {
        return { error: `${etiqueta} debe ser un número entero entre ${min} y ${max}` };
    }

    return { valor: numero };
}

function decimalOpcional(valor, { min, max, etiqueta }) {
    if (valor === null || valor === undefined || valor === "") {
        return { valor: null };
    }

    const numero = Number(String(valor).replace(",", "."));

    if (!Number.isFinite(numero) || numero < min || numero > max) {
        return { error: `${etiqueta} debe ser un número entre ${min} y ${max}` };
    }

    return { valor: Math.round(numero * 100) / 100 };
}

function booleano(valor) {
    return valor === true || valor === 1 || valor === "1" || valor === "true";
}

// Los datos pendientes se calculan siempre en el servidor para que el aviso
// de la interfaz no dependa de lo que envíe el navegador.
function calcularPendiente(casa) {
    return CAMPOS_OBLIGATORIOS.some(([campo]) => {
        const valor = casa[campo];
        return valor === null || valor === undefined || valor === "";
    }) ? 1 : 0;
}

function camposFaltantes(casa) {
    return CAMPOS_OBLIGATORIOS
        .filter(([campo]) => {
            const valor = casa[campo];
            return valor === null || valor === undefined || valor === "";
        })
        .map(([, etiqueta]) => etiqueta);
}

function normalizarCasa(body) {
    const nombre = textoOpcional(body.nombre, 150);

    if (nombre.error) return { error: `Nombre: ${nombre.error}` };
    if (!nombre.valor) return { error: "El nombre de la casa es obligatorio" };

    const datos = { nombre: nombre.valor };

    for (const [campo, maximo] of CAMPOS_TEXTO) {
        const resultado = textoOpcional(body[campo], maximo);

        if (resultado.error) {
            return { error: `${campo}: ${resultado.error}` };
        }

        datos[campo] = resultado.valor;
    }

    const tipo = textoOpcional(body.tipo, 30);

    if (tipo.error) return { error: `Tipo: ${tipo.error}` };

    if (tipo.valor && !TIPOS_SERVICIO.includes(tipo.valor)) {
        return {
            error: `Tipo de servicio no válido. Valores admitidos: ${TIPOS_SERVICIO.join(", ")}`
        };
    }

    datos.tipo = tipo.valor;

    const visitas = enteroOpcional(body.visitas_por_periodo, {
        min: 0,
        max: 255,
        etiqueta: "Visitas por periodo"
    });

    if (visitas.error) return { error: visitas.error };
    datos.visitas_por_periodo = visitas.valor;

    const periodo = enteroOpcional(body.periodo_dias, {
        min: 1,
        max: 3650,
        etiqueta: "Días del periodo"
    });

    if (periodo.error) return { error: periodo.error };
    datos.periodo_dias = periodo.valor;

    const precio = decimalOpcional(body.precio_hora, {
        min: 0,
        max: 9999,
        etiqueta: "Precio por hora"
    });

    if (precio.error) return { error: precio.error };
    datos.precio_hora = precio.valor;

    const duracion = enteroOpcional(body.duracion_minutos, {
        min: 1,
        max: 65535,
        etiqueta: "Duración de referencia (minutos)"
    });

    if (duracion.error) return { error: duracion.error };
    datos.duracion_minutos = duracion.valor;

    datos.emite_factura = booleano(body.emite_factura) ? 1 : 0;
    datos.datos_pendientes = calcularPendiente(datos);

    return { datos };
}

// GET /api/casas
router.get("/", async (req, res) => {
    try {
        const [casas] = await db.query(`
            SELECT ${COLUMNAS_CASA}
            FROM casas
            ORDER BY nombre ASC
        `);

        res.json({
            ok: true,
            casas: casas.map((casa) => ({
                ...casa,
                campos_faltantes: camposFaltantes(casa)
            }))
        });

    } catch (error) {
        console.error("Error obteniendo casas:", error);

        res.status(500).json({
            ok: false,
            error: "Error obteniendo casas"
        });
    }
});


// POST /api/casas
router.post("/", async (req, res) => {
    try {
        const validacion = normalizarCasa(req.body);

        if (validacion.error) {
            return res.status(400).json({
                ok: false,
                error: validacion.error
            });
        }

        const datos = validacion.datos;

        const [resultado] = await db.query(
            `
            INSERT INTO casas (
                nombre,
                nombre_cliente,
                apellidos_cliente,
                direccion,
                contacto,
                codigo_postal,
                poblacion,
                tipo,
                frecuencia_texto,
                visitas_por_periodo,
                periodo_dias,
                precio_hora,
                duracion_minutos,
                emite_factura,
                observaciones,
                datos_pendientes
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
                datos.nombre,
                datos.nombre_cliente,
                datos.apellidos_cliente,
                datos.direccion,
                datos.contacto,
                datos.codigo_postal,
                datos.poblacion,
                datos.tipo,
                datos.frecuencia_texto,
                datos.visitas_por_periodo,
                datos.periodo_dias,
                datos.precio_hora,
                datos.duracion_minutos,
                datos.emite_factura,
                datos.observaciones,
                datos.datos_pendientes
            ]
        );

        res.status(201).json({
            ok: true,
            mensaje: "Casa creada correctamente",
            casa: {
                id: resultado.insertId,
                ...datos,
                activo: 1,
                campos_faltantes: camposFaltantes(datos)
            }
        });

    } catch (error) {
        console.error("Error creando casa:", error);

        if (error.code === "ER_DUP_ENTRY") {
            return res.status(409).json({
                ok: false,
                error: "Esa casa ya existe"
            });
        }

        res.status(500).json({
            ok: false,
            error: "Error creando casa"
        });
    }
});

// PUT /api/casas/:id
router.put("/:id", async (req, res) => {
    try {
        const { id } = req.params;

        const validacion = normalizarCasa(req.body);

        if (validacion.error) {
            return res.status(400).json({
                ok: false,
                error: validacion.error
            });
        }

        const datos = validacion.datos;

        const [existe] = await db.query(
            "SELECT id FROM casas WHERE id = ?",
            [id]
        );

        if (existe.length === 0) {
            return res.status(404).json({
                ok: false,
                error: "Casa no encontrada"
            });
        }

        await db.query(
            `
            UPDATE casas
            SET
                nombre = ?,
                nombre_cliente = ?,
                apellidos_cliente = ?,
                direccion = ?,
                contacto = ?,
                codigo_postal = ?,
                poblacion = ?,
                tipo = ?,
                frecuencia_texto = ?,
                visitas_por_periodo = ?,
                periodo_dias = ?,
                precio_hora = ?,
                duracion_minutos = ?,
                emite_factura = ?,
                observaciones = ?,
                datos_pendientes = ?
            WHERE id = ?
            `,
            [
                datos.nombre,
                datos.nombre_cliente,
                datos.apellidos_cliente,
                datos.direccion,
                datos.contacto,
                datos.codigo_postal,
                datos.poblacion,
                datos.tipo,
                datos.frecuencia_texto,
                datos.visitas_por_periodo,
                datos.periodo_dias,
                datos.precio_hora,
                datos.duracion_minutos,
                datos.emite_factura,
                datos.observaciones,
                datos.datos_pendientes,
                id
            ]
        );

        res.json({
            ok: true,
            mensaje: "Casa actualizada correctamente",
            casa: {
                id: Number(id),
                ...datos,
                campos_faltantes: camposFaltantes(datos)
            }
        });

    } catch (error) {
        console.error("Error actualizando casa:", error);

        if (error.code === "ER_DUP_ENTRY") {
            return res.status(409).json({
                ok: false,
                error: "Esa casa ya existe"
            });
        }

        res.status(500).json({
            ok: false,
            error: "Error actualizando casa"
        });
    }
});

// PATCH /api/casas/:id/activo
router.patch("/:id/activo", async (req, res) => {
    try {
        const { id } = req.params;
        const { activo } = req.body;

        if (typeof activo !== "boolean") {
            return res.status(400).json({
                ok: false,
                error: "El campo activo debe ser verdadero o falso"
            });
        }

        const [resultado] = await db.query(
            `
            UPDATE casas
            SET activo = ?
            WHERE id = ?
            `,
            [activo, id]
        );

        if (resultado.affectedRows === 0) {
            return res.status(404).json({
                ok: false,
                error: "Casa no encontrada"
            });
        }

        res.json({
            ok: true,
            mensaje: activo ? "Casa activada correctamente" : "Casa desactivada correctamente"
        });

    } catch (error) {
        console.error("Error cambiando estado de casa:", error);

        res.status(500).json({
            ok: false,
            error: "Error cambiando estado de casa"
        });
    }
});


// DELETE /api/casas/:id
// Solo elimina si la casa no tiene horarios ni facturas. Si los tiene, la
// clave foránea RESTRICT lo impediría igualmente: se devuelve 409 para que la
// interfaz ofrezca desactivarla en lugar de perder historial.
router.delete("/:id", async (req, res) => {
    try {
        const { id } = req.params;

        const [existe] = await db.query(
            "SELECT id, nombre FROM casas WHERE id = ?",
            [id]
        );

        if (existe.length === 0) {
            return res.status(404).json({
                ok: false,
                error: "Casa no encontrada"
            });
        }

        const [horarios] = await db.query(
            "SELECT COUNT(*) AS total FROM horarios WHERE casa_id = ?",
            [id]
        );

        const [facturas] = await db.query(
            "SELECT COUNT(*) AS total FROM facturas WHERE casa_id = ?",
            [id]
        );

        const totalHorarios = horarios[0].total;
        const totalFacturas = facturas[0].total;

        if (totalHorarios > 0 || totalFacturas > 0) {
            return res.status(409).json({
                ok: false,
                error: "No se puede eliminar: la casa tiene datos asociados",
                detalle: {
                    horarios: totalHorarios,
                    facturas: totalFacturas
                },
                sugerencia:
                    "Desactívala para que deje de aparecer en los análisis sin perder el historial"
            });
        }

        await db.query("DELETE FROM casas WHERE id = ?", [id]);

        res.json({
            ok: true,
            mensaje: "Casa eliminada correctamente"
        });

    } catch (error) {
        console.error("Error eliminando casa:", error);

        if (error.code === "ER_ROW_IS_REFERENCED_2") {
            return res.status(409).json({
                ok: false,
                error: "No se puede eliminar: la casa tiene datos asociados",
                sugerencia:
                    "Desactívala para que deje de aparecer en los análisis sin perder el historial"
            });
        }

        res.status(500).json({
            ok: false,
            error: "Error eliminando casa"
        });
    }
});


// GET /api/casas/resumen-facturacion?mes=&anio=
router.get("/resumen-facturacion", async (req, res) => {
  try {
    const ahora = new Date();
    const mes = Number(req.query.mes) || ahora.getMonth() + 1;
    const anio = Number(req.query.anio) || ahora.getFullYear();

    const [casas] = await db.query(
      `
      SELECT
        c.id,
        c.nombre,
        c.direccion,
        c.duracion_minutos,
        c.activo,
        COALESCE(v.total_visitas, 0) AS total_visitas,
        COALESCE(v.total_facturable_minutos, 0) AS total_facturable_minutos,
        COALESCE(v.visitas_pendientes, 0) AS visitas_pendientes,
        COALESCE(f.borradores, 0) AS facturas_borrador,
        COALESCE(f.emitidas, 0) AS facturas_emitidas,
        COALESCE(f.pagadas, 0) AS facturas_pagadas,
        COALESCE(f.anuladas, 0) AS facturas_anuladas
      FROM casas c
      LEFT JOIN (
        SELECT
          h.casa_id,
          COUNT(*) AS total_visitas,
          SUM(
            COALESCE(
              h.duracion_facturable_minutos,
              c2.duracion_minutos,
              0
            )
          ) AS total_facturable_minutos,
          SUM(
            CASE
              WHEN COALESCE(
                h.duracion_facturable_minutos,
                c2.duracion_minutos
              ) IS NULL THEN 1
              ELSE 0
            END
          ) AS visitas_pendientes
        FROM horarios h
        INNER JOIN dias d ON d.id = h.dia_id
        INNER JOIN casas c2 ON c2.id = h.casa_id
        WHERE MONTH(d.fecha) = ? AND YEAR(d.fecha) = ?
        GROUP BY h.casa_id
      ) v ON v.casa_id = c.id
      LEFT JOIN (
        SELECT
          casa_id,
          SUM(estado = 'borrador') AS borradores,
          SUM(estado = 'emitida') AS emitidas,
          SUM(estado = 'pagada') AS pagadas,
          SUM(estado = 'anulada') AS anuladas
        FROM facturas
        WHERE fecha_inicio_periodo <= LAST_DAY(?) AND fecha_fin_periodo >= ?
        GROUP BY casa_id
      ) f ON f.casa_id = c.id
      ORDER BY c.nombre ASC
      `,
      [
        mes,
        anio,
        `${anio}-${String(mes).padStart(2, "0")}-01`,
        `${anio}-${String(mes).padStart(2, "0")}-01`,
      ],
    );

    res.json({
      ok: true,
      mes,
      anio,
      casas,
    });
  } catch (error) {
    console.error("Error obteniendo resumen de facturación:", error);
    res.status(500).json({
      ok: false,
      error: "Error obteniendo resumen de facturación",
    });
  }
});

// GET /api/casas/:id/visitas?mes=&anio=&desde=&hasta=
router.get("/:id/visitas", async (req, res) => {
  try {
    const { id } = req.params;
    const { mes, anio, desde, hasta } = req.query;

    const [casas] = await db.query(
      `
      SELECT id, nombre, direccion, duracion_minutos, activo
      FROM casas
      WHERE id = ?
      `,
      [id],
    );

    if (casas.length === 0) {
      return res.status(404).json({
        ok: false,
        error: "Casa no encontrada",
      });
    }

    const casa = casas[0];

    let where = "h.casa_id = ?";
    const params = [id];

    if (desde && hasta) {
      where += " AND d.fecha BETWEEN ? AND ?";
      params.push(desde, hasta);
    } else if (mes && anio) {
      where += " AND MONTH(d.fecha) = ? AND YEAR(d.fecha) = ?";
      params.push(Number(mes), Number(anio));
    }

    const [visitas] = await db.query(
      `
      SELECT
        h.id,
        d.fecha,
        h.hora_inicio,
        h.hora_fin,
        h.duracion_facturable_minutos,
        c.duracion_minutos AS duracion_habitual_minutos
      FROM horarios h
      INNER JOIN dias d ON d.id = h.dia_id
      INNER JOIN casas c ON c.id = h.casa_id
      WHERE ${where}
      ORDER BY d.fecha DESC, h.hora_inicio ASC
      `,
      params,
    );

    const ids = visitas.map((visita) => visita.id);
    const trabajadoresPorVisita = {};
    const facturadas = new Set();

    if (ids.length > 0) {
      const [trabajadores] = await db.query(
        `
        SELECT ht.horario_id, t.id, t.nombre, t.codigo
        FROM horario_trabajadores ht
        INNER JOIN trabajadores t ON t.id = ht.trabajador_id
        WHERE ht.horario_id IN (?)
        `,
        [ids],
      );

      for (const fila of trabajadores) {
        if (!trabajadoresPorVisita[fila.horario_id]) {
          trabajadoresPorVisita[fila.horario_id] = [];
        }
        trabajadoresPorVisita[fila.horario_id].push({
          id: fila.id,
          nombre: fila.nombre,
          codigo: fila.codigo,
        });
      }

      const [facturadasRows] = await db.query(
        `
        SELECT DISTINCT fd.horario_id
        FROM factura_detalles fd
        INNER JOIN facturas f ON f.id = fd.factura_id
        WHERE fd.horario_id IN (?)
          AND f.estado IN ('emitida', 'pagada')
        `,
        [ids],
      );

      for (const fila of facturadasRows) {
        facturadas.add(fila.horario_id);
      }
    }

    const visitasMapeadas = visitas.map((visita) => {
      const duracionResuelta =
        visita.duracion_facturable_minutos != null
          ? visita.duracion_facturable_minutos
          : visita.duracion_habitual_minutos;

      return {
        id: visita.id,
        fecha: visita.fecha,
        hora_inicio: visita.hora_inicio,
        hora_fin: visita.hora_fin,
        duracion_facturable_minutos: visita.duracion_facturable_minutos,
        duracion_habitual_minutos: visita.duracion_habitual_minutos,
        duracion_resuelta_minutos: duracionResuelta,
        pendiente_revision: duracionResuelta == null,
        facturada: facturadas.has(visita.id),
        trabajadores: trabajadoresPorVisita[visita.id] || [],
      };
    });

    const totalVisitas = visitasMapeadas.length;
    const totalFacturableMinutos = visitasMapeadas.reduce(
      (acumulado, visita) =>
        acumulado + (visita.duracion_resuelta_minutos || 0),
      0,
    );

    res.json({
      ok: true,
      casa,
      total_visitas: totalVisitas,
      total_facturable_minutos: totalFacturableMinutos,
      visitas: visitasMapeadas,
    });
  } catch (error) {
    console.error("Error obteniendo visitas de casa:", error);
    res.status(500).json({
      ok: false,
      error: "Error obteniendo visitas de la casa",
    });
  }
});

module.exports = router;
