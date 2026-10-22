export const rebarSpecifications = [
  { size: '#3', weightPerFoot: 0.376, overlap: 1.38 },
  { size: '#4', weightPerFoot: 0.668, overlap: 1.83 },
  { size: '#5', weightPerFoot: 1.043, overlap: 2.29 },
  { size: '#6', weightPerFoot: 1.502, overlap: 2.75 },
  { size: '#7', weightPerFoot: 2.044, overlap: 3.21 },
  { size: '#8', weightPerFoot: 2.67, overlap: 3.67 },
] as const;

export const rebarWeightPerFoot: Record<string, number> = Object.fromEntries(
  rebarSpecifications.map(({ size, weightPerFoot }) => [size, weightPerFoot]),
);
