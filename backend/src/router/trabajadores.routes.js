const express = require("express");
const db = require("../config/db");

const router = express.Router();


// GET /api/trabajadores
// Obtener todos los trabajadores
router.get("/", async (req, res) => {
    try {
        const [trabajadores] = await db.query(`
            SELECT
                id,
                nombre,
                codigo,
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
        const { nombre, codigo } = req.body;

        if (!nombre || !codigo) {
            return res.status(400).json({
                ok: false,
                error: "El nombre y el código son obligatorios"
            });
        }

        const [resultado] = await db.query(
            `
            INSERT INTO trabajadores (nombre, codigo)
            VALUES (?, ?)
            `,
            [nombre.trim(), codigo.trim().toUpperCase()]
        );

        res.status(201).json({
            ok: true,
            mensaje: "Trabajador creado correctamente",
            trabajador: {
                id: resultado.insertId,
                nombre: nombre.trim(),
                codigo: codigo.trim().toUpperCase()
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
        const { nombre, codigo } = req.body;

        if (!nombre || !nombre.trim() || !codigo || !codigo.trim()) {
            return res.status(400).json({
                ok: false,
                error: "El nombre y el código son obligatorios"
            });
        }

        const [resultado] = await db.query(
            `
            UPDATE trabajadores
            SET
                nombre = ?,
                codigo = ?
            WHERE id = ?
            `,
            [nombre.trim(), codigo.trim().toUpperCase(), id]
        );

        if (resultado.affectedRows === 0) {
            return res.status(404).json({
                ok: false,
                error: "Trabajador no encontrado"
            });
        }

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

module.exports = router;
