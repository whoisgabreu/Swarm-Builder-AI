export const formatUsd = (value: number): string => `US$ ${value.toFixed(value < 0.1 ? 3 : 2).replace(".", ",")}`;
export const formatCents = (value: number): string => `${(value * 100).toFixed(1).replace(".", ",")}¢ USD`;
