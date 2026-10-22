// Etat du PC pour le HUD de JARVIS : processeur, memoire, carte graphique.
// Interroge seulement quand le HUD le demande (toutes les ~2 s quand il est
// affiche) ; nvidia-smi n'est appele que si une carte NVIDIA est presente.
const { execFile } = require("node:child_process");
const os = require("node:os");

let previousCpu = null;
let hasNvidia = null;

function cpuTimes() {
  return os.cpus().reduce(
    (total, cpu) => {
      const times = cpu.times;
      total.idle += times.idle;
      total.all += times.user + times.nice + times.sys + times.idle + times.irq;
      return total;
    },
    { idle: 0, all: 0 }
  );
}

function cpuUsage() {
  const current = cpuTimes();
  const previous = previousCpu;
  previousCpu = current;
  if (!previous || current.all === previous.all) {
    return null;
  }
  return Math.round((1 - (current.idle - previous.idle) / (current.all - previous.all)) * 100);
}

function gpuStats() {
  if (hasNvidia === false) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    execFile(
      "nvidia-smi",
      ["--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu", "--format=csv,noheader,nounits"],
      { windowsHide: true, timeout: 4000 },
      (error, stdout) => {
        if (error) {
          hasNvidia = false;
          resolve(null);
          return;
        }
        hasNvidia = true;
        const [name, usage, used, total, temperature] = String(stdout).split("\n")[0].split(",").map((part) => part.trim());
        resolve({ name, usage: Number(usage), memoryUsed: Number(used), memoryTotal: Number(total), temperature: Number(temperature) });
      }
    );
  });
}

async function getStats() {
  return {
    cpu: { model: os.cpus()[0]?.model?.trim() || "", cores: os.cpus().length, usage: cpuUsage() },
    memory: { total: os.totalmem(), free: os.freemem() },
    gpu: await gpuStats(),
    uptime: os.uptime(),
    host: os.hostname()
  };
}

module.exports = { getStats };
