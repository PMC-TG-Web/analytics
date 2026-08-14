export function procoreAutomationCadence(now = new Date()) {
  const minute = now.getUTCMinutes();
  return {
    runHealthMonitor: minute % 15 === 0,
    runProjectReconciliation: minute === 10,
    runActualsReconciliation: minute === 40,
  };
}
