import { continuumLength } from "../App";

export function quadraticScale(x: number, maxVal: number = continuumLength): number {
    // Normalize x to the range [0, maxVal] then square and scale to [0, 1]
    return (x / maxVal) ** 2;
}
