const express = require("express");
const cors = require("cors");

const horariosRoutes = require("./router/horarios.routes");
const trabajadoresRoutes = require("./router/trabajadores.routes");
const casasRoutes = require("./router/casas.routes");
const facturasRoutes = require("./router/facturas.routes");

const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/health", (req, res) => {
  res.json({
    ok: true,
    messange: "api funcioonando",
  });
});

app.use("/api/horarios", horariosRoutes);
app.use("/api/trabajadores", trabajadoresRoutes);
app.use("/api/casas", casasRoutes);
app.use("/api/facturas", facturasRoutes);

app.get("/", (req, res) => {
    res.send("API funca");
});

module.exports = app;