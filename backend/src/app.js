const express = require("express");
const cors = require("cors");

const horariosRoutes = require("./router/horarios.routes");
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


app.get("/", (req, res) => {
    res.send("API funca");
});

module.exports = app;