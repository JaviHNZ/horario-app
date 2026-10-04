const express = require("express");
const multer = require("multer");

const router = express.Router();

const { analizarHorario } = require("../services/gemini.service");

const upload = multer({
  dest: "uploads/",
});

router.post("/analizar", upload.single("imagen"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        ok: false,
        error: "No se ha enviado ninguna imagen",
      });
    }

    console.log("Imagen recibida:", req.file.originalname);

    const resultado = await analizarHorario(req.file.path, req.file.mimetype);

    res.json({
      ok: true,
      resultado,
    });
  } catch (error) {
    console.error("Error analizando horario:", error);

    res.status(500).json({
      ok: false,
      error: "Error al analizar la imagen",
    });
  }
});

module.exports = router;
