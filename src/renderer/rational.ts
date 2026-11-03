const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))

/**
 * An exact rational number: the type of notated time, which floating point
 * would blur (three triplet eighths must add up to exactly one quarter).
 * Values are always normalised, so equal numbers have equal representations.
 */
export class Rational {
    private constructor(readonly numerator: number, readonly denominator: number) {}

    static of(numerator: number, denominator = 1): Rational {
        if (!Number.isInteger(numerator) || !Number.isInteger(denominator) || denominator === 0) {
            throw new RangeError(`not a rational number: ${numerator}/${denominator}`)
        }
        const divisor = gcd(Math.abs(numerator), Math.abs(denominator)) * Math.sign(denominator)
        return new Rational(numerator / divisor || 0, denominator / divisor)
    }

    static readonly zero = Rational.of(0)

    plus(other: Rational): Rational {
        return Rational.of(
            this.numerator * other.denominator + other.numerator * this.denominator,
            this.denominator * other.denominator
        )
    }

    minus(other: Rational): Rational {
        return this.plus(Rational.of(-other.numerator, other.denominator))
    }

    times(other: Rational): Rational {
        return Rational.of(this.numerator * other.numerator, this.denominator * other.denominator)
    }

    compare(other: Rational): number {
        return Math.sign(this.numerator * other.denominator - other.numerator * this.denominator)
    }

    equals(other: Rational): boolean {
        return this.numerator === other.numerator && this.denominator === other.denominator
    }

    toNumber(): number {
        return this.numerator / this.denominator
    }

    /** A canonical key, so that rationals can index maps. */
    toString(): string {
        return `${this.numerator}/${this.denominator}`
    }
}

export const sumOf = (values: readonly Rational[]): Rational =>
    values.reduce((total, value) => total.plus(value), Rational.zero)

/** The largest of non-negative values; zero when there are none. */
export const maxOf = (values: readonly Rational[]): Rational =>
    values.reduce((max, value) => (value.compare(max) > 0 ? value : max), Rational.zero)
