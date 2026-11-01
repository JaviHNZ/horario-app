const express = require("express");
const db = require("../config/db");

const router = express.Router();

const CAMPOS_TEXTO_TRABAJADOR = [
    ["apellidos", 150],
    ["contacto", 20],
    ["direccion", 255],
    ["poblacion", 100]
];

function textoOpcionalTrabajador(valor, maximo) {
    if (valor === null || valor === undefined) return { valor: null };

    const limpio = String(valor).trim();
    if (!limpio) return { valor: null };

    if (limpio.length > maximo) {
        return { error: `no puede superar ${maximo} caracteres` };
    }

    return { valor: limpio };
}

function datosPendientesTrabajador(datos) {
    return CAMPOS_TEXTO_TRABAJADOR.some(([campo]) => !datos[campo]) ? 1 : 0;
}

function normalizarTrabajador(body) {
    const nombre = textoOpcionalTrabajador(body.nombre, 100);
    const codigo = textoOpcionalTrabajador(body.codigo, 10);

    if (!nombre.valor || !codigo.valor) {
        return { error: "El nombre y el código son obligatorios" };
    }

    const datos = {
        nombre: nombre.valor,
        codigo: codigo.valor.toUpperCase()
    };

    for (const [campo, maximo] of CAMPOS_TEXTO_TRABAJADOR) {
        const resultado = textoOpcionalTrabajador(body[campo], maximo);

        if (resultado.error) {
            return { error: `${campo}: ${resultado.error}` };
        }

        datos[campo] = resultado.valor;
    }

    datos.datos_pendientes = datosPendientesTrabajador(datos);

    return { datos };
}


// GET /api/trabajadores
// Obtener todos los trabajadores
router.get("/", async (req, res) => {
    try {
        const [trabajadores] = await db.query(`
            SELECT
                id,
                nombre,
                apellidos,
                codigo,
                contacto,
                direccion,
                poblacion,
                datos_pendientes,
                activo,
                fecha_creacion,
                fecha_actualizacion
            FROM trabajadores
            ORDER BY nombre ASC
        `);

        res.json({
            ok: true,
            trabajadores
        });

    } catch (error) {
        console.error("Error obteniendo trabajadores:", error);

        res.status(500).json({
            ok: false,
            error: "Error obteniendo trabajadores"
        });
    }
});
// POST /api/trabajadores
// Crear un nuevo trabajador
router.post("/", async (req, res) => {
    try {
        const validacion = normalizarTrabajador(req.body);

        if (validacion.error) {
            return res.status(400).json({
                ok: false,
                error: validacion.error
            });
        }

        const datos = validacion.datos;

        const [resultado] = await db.query(
            `
            INSERT INTO trabajadores (
                nombre,
                apellidos,
                codigo,
                contacto,
                direccion,
                poblacion,
                datos_pendientes
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            `,
            [
                datos.nombre,
                datos.apellidos,
                datos.codigo,
                datos.contacto,
                datos.direccion,
                datos.poblacion,
                datos.datos_pendientes
            ]
        );

        res.status(201).json({
            ok: true,
            mensaje: "Trabajador creado correctamente",
            trabajador: {
                id: resultado.insertId,
                ...datos,
                activo: 1
            }
        });

    } catch (error) {
        console.error("Error creando trabajador:", error);

        if (error.code === "ER_DUP_ENTRY") {
            return res.status(409).json({
                ok: false,
                error: "Ese código de trabajador ya existe"
            });
        }

        res.status(500).json({
            ok: false,
            error: "Error creando trabajador"
        });
    }
});

// PUT /api/trabajadores/:id
// Actualizar nombre y código sin borrar historial
router.put("/:id", async (req, res) => {
    try {
        const { id } = req.params;

        const validacion = normalizarTrabajador(req.body);

        if (validacion.error) {
            return res.status(400).json({
                ok: false,
                error: validacion.error
            });
        }

        const datos = validacion.datos;

        const [existe] = await db.query(
            "SELECT id FROM trabajadores WHERE id = ?",
            [id]
        );

        if (existe.length === 0) {
            return res.status(404).json({
                ok: false,
                error: "Trabajador no encontrado"
            });
        }

        await db.query(
            `
            UPDATE trabajadores
            SET
                nombre = ?,
                apellidos = ?,
                codigo = ?,
                contacto = ?,
                direccion = ?,
                poblacion = ?,
                datos_pendientes = ?
            WHERE id = ?
            `,
            [
                datos.nombre,
                datos.apellidos,
                datos.codigo,
                datos.contacto,
                datos.direccion,
                datos.poblacion,
                datos.datos_pendientes,
                id
            ]
        );

        res.json({
            ok: true,
            mensaje: "Trabajador actualizado correctamente"
        });

    } catch (error) {
        console.error("Error actualizando trabajador:", error);

        if (error.code === "ER_DUP_ENTRY") {
            return res.status(409).json({
                ok: false,
                error: "Ese código de trabajador ya existe"
            });
        }

        res.status(500).json({
            ok: false,
            error: "Error actualizando trabajador"
        });
    }
});

// PATCH /api/trabajadores/:id/activo
// Activar o desactivar sin eliminar datos históricos
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
            UPDATE trabajadores
            SET activo = ?
            WHERE id = ?
            `,
            [activo, id]
        );

        if (resultado.affectedRows === 0) {
            return res.status(404).json({
                ok: false,
                error: "Trabajador no encontrado"
            });
        }

        res.json({
            ok: true,
            mensaje: activo ? "Trabajador activado correctamente" : "Trabajador desactivado correctamente"
        });

    } catch (error) {
        console.error("Error cambiando estado de trabajador:", error);

        res.status(500).json({
            ok: false,
            error: "Error cambiando estado de trabajador"
        });
    }
});

// GET /api/trabajadores/resumen-diario?fecha=YYYY-MM-DD
router.get("/resumen-diario", async (req, res) => {
  try {
    const hoy = new Date();
    const fecha =
      req.query.fecha ||
      `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-${String(hoy.getDate()).padStart(2, "0")}`;

    const [trabajadores] = await db.query(
      `
      SELECT
        t.id,
        t.nombre,
        t.codigo,
        t.activo,
        COALESCE(SUM(
          CASE
            WHEN d.fecha = ? THEN
              CASE
                WHEN h.hora_fin < h.hora_inicio
                  THEN TIMESTAMPDIFF(MINUTE, h.hora_inicio, h.hora_fin) + 1440
                ELSE TIMESTAMPDIFF(MINUTE, h.hora_inicio, h.hora_fin)
              END
            ELSE 0
          END
        ), 0) AS minutos_trabajados
      FROM trabajadores t
      LEFT JOIN horario_trabajadores ht ON ht.trabajador_id = t.id
      LEFT JOIN horarios h ON h.id = ht.horario_id
      LEFT JOIN dias d ON d.id = h.dia_id
      WHERE t.activo = TRUE
      GROUP BY t.id, t.nombre, t.codigo, t.activo
      ORDER BY t.nombre ASC
      `,
      [fecha],
    );

    res.json({
      ok: true,
      fecha,
      trabajadores,
    });
  } catch (error) {
    console.error("Error obteniendo resumen diario:", error);
    res.status(500).json({
      ok: false,
      error: "Error obteniendo resumen diario",
    });
  }
});

// GET /api/trabajadores/:id/perfil?mes=&anio=&desde=&hasta=
router.get("/:id/perfil", async (req, res) => {
  try {
    const { id } = req.params;
    const { mes, anio, desde, hasta } = req.query;

    const [trabajadores] = await db.query(
      `
      SELECT id, nombre, codigo, activo, fecha_creacion, fecha_actualizacion
      FROM trabajadores
      WHERE id = ?
      `,
      [id],
    );

    if (trabajadores.length === 0) {
      return res.status(404).json({
        ok: false,
        error: "Trabajador no encontrado",
      });
    }

    const trabajador = trabajadores[0];

    let where = "ht.trabajador_id = ?";
    const params = [id];

    if (desde && hasta) {
      where += " AND d.fecha BETWEEN ? AND ?";
      params.push(desde, hasta);
    } else if (mes && anio) {
      where += " AND MONTH(d.fecha) = ? AND YEAR(d.fecha) = ?";
      params.push(Number(mes), Number(anio));
    }

    const [servicios] = await db.query(
      `
      SELECT
        h.id,
        d.fecha,
        c.id AS casa_id,
        c.nombre AS casa,
        h.hora_inicio,
        h.hora_fin
      FROM horarios h
      INNER JOIN dias d ON d.id = h.dia_id
      INNER JOIN casas c ON c.id = h.casa_id
      INNER JOIN horario_trabajadores ht ON ht.horario_id = h.id
      WHERE ${where}
      ORDER BY d.fecha DESC, h.hora_inicio ASC
      `,
      params,
    );

    const ids = servicios.map((servicio) => servicio.id);
    const otrosPorHorario = {};

    if (ids.length > 0) {
      const [otros] = await db.query(
        `
        SELECT ht.horario_id, t.id, t.nombre, t.codigo
        FROM horario_trabajadores ht
        INNER JOIN trabajadores t ON t.id = ht.trabajador_id
        WHERE ht.horario_id IN (?)
        `,
        [ids],
      );

      for (const fila of otros) {
        if (Number(fila.id) === Number(id)) {
          continue;
        }
        if (!otrosPorHorario[fila.horario_id]) {
          otrosPorHorario[fila.horario_id] = [];
        }
        otrosPorHorario[fila.horario_id].push({
          id: fila.id,
          nombre: fila.nombre,
          codigo: fila.codigo,
        });
      }
    }

    const calcularMinutos = (inicio, fin) => {
      const [h1, m1] = String(inicio).slice(0, 5).split(":").map(Number);
      const [h2, m2] = String(fin).slice(0, 5).split(":").map(Number);
      let minutos = (h2 * 60 + m2) - (h1 * 60 + m1);
      if (minutos < 0) {
        minutos += 1440;
      }
      return minutos;
    };

    const serviciosMapeados = servicios.map((servicio) => ({
      id: servicio.id,
      fecha: servicio.fecha,
      casa_id: servicio.casa_id,
      casa: servicio.casa,
      hora_inicio: servicio.hora_inicio,
      hora_fin: servicio.hora_fin,
      duracion_minutos: calcularMinutos(servicio.hora_inicio, servicio.hora_fin),
      otros_trabajadores: otrosPorHorario[servicio.id] || [],
    }));

    const totalMinutos = serviciosMapeados.reduce(
      (acumulado, servicio) => acumulado + servicio.duracion_minutos,
      0,
    );

    const casasDistintas = new Set(
      serviciosMapeados.map((servicio) => servicio.casa_id),
    ).size;

    res.json({
      ok: true,
      trabajador,
      total_minutos: totalMinutos,
      total_servicios: serviciosMapeados.length,
      casas_distintas: casasDistintas,
      servicios: serviciosMapeados,
    });
  } catch (error) {
    console.error("Error obteniendo perfil de trabajador:", error);
    res.status(500).json({
      ok: false,
      error: "Error obteniendo perfil de trabajador",
    });
  }
});

module.exports = router;
