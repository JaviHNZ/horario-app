const express = require("express");
const db = require("../config/db");

const router = express.Router();

// GET /api/casas
router.get("/", async (req, res) => {
    try {
        const [casas] = await db.query(`
            SELECT
                id,
                nombre,
                direccion,
                duracion_minutos,
                activo,
                fecha_creacion,
                fecha_actualizacion
            FROM casas
            ORDER BY nombre ASC
        `);

        res.json({
            ok: true,
            casas
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
        const {
            nombre,
            direccion,
            duracion_minutos
        } = req.body;

        if (!nombre) {
            return res.status(400).json({
                ok: false,
                error: "El nombre de la casa es obligatorio"
            });
        }

        const [resultado] = await db.query(
            `
            INSERT INTO casas (
                nombre,
                direccion,
                duracion_minutos
            )
            VALUES (?, ?, ?)
            `,
            [
                nombre.trim(),
                direccion?.trim() || null,
                duracion_minutos || null
            ]
        );

        res.status(201).json({
            ok: true,
            mensaje: "Casa creada correctamente",
            casa: {
                id: resultado.insertId,
                nombre: nombre.trim(),
                direccion: direccion?.trim() || null,
                duracion_minutos: duracion_minutos || null
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
        const { nombre, direccion, duracion_minutos } = req.body;

        if (!nombre || !nombre.trim()) {
            return res.status(400).json({
                ok: false,
                error: "El nombre de la casa es obligatorio"
            });
        }

        const duracion = duracion_minutos === "" || duracion_minutos === null || duracion_minutos === undefined
            ? null
            : Number(duracion_minutos);

        const [resultado] = await db.query(
            `
            UPDATE casas
            SET
                nombre = ?,
                direccion = ?,
                duracion_minutos = ?
            WHERE id = ?
            `,
            [
                nombre.trim(),
                direccion?.trim() || null,
                duracion,
                id
            ]
        );

        if (resultado.affectedRows === 0) {
            return res.status(404).json({
                ok: false,
                error: "Casa no encontrada"
            });
        }

        res.json({
            ok: true,
            mensaje: "Casa actualizada correctamente"
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


module.exports = router;
