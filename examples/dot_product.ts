// @typethon target: python
// @typethon import: numpy as np

function dotProduct(a: number[], b: number[]): number {
    let total = 0;
    for (let i = 0; i < a.length; i++) {
        total = total + a[i] * b[i];
    }
    return total;
}
