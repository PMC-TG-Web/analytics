export function procoreAutomationCadence(now = new Date()) {
  const hour = now.getUTCHours();
  const minute = now.getUTCMinutes();
  return {
    runHealthMonitor: minute % 15 === 0,
    runProjectReconciliation: hour === 7 && minute === 10,
    runActualsReconciliation: minute === 40,
  };
}
