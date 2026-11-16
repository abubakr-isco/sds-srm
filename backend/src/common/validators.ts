import { Transform } from 'class-transformer';
import { registerDecorator, ValidationOptions } from 'class-validator';
import { isIsoDay } from './dates';

/** Trims strings; turns "" into null when `emptyToNull` is set. */
export const Trim = (emptyToNull = false) =>
  Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    const t = value.trim();
    return emptyToNull && t === '' ? null : t;
  });

/** Normalises a number or numeric string to a canonical decimal string (exact; no float math). */
export const ToDecimalString = () =>
  Transform(({ value }) => {
    if (value === null || value === undefined || value === '') return value === '' ? null : value;
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NaN';
    return typeof value === 'string' ? value.trim() : value;
  });

/** Decimal string with up to `scale` fractional digits, within [min, max]. */
export function IsDecimalString(opts: { scale: number; min: number; max: number }, validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => registerDecorator({
    name: 'isDecimalString', target: object.constructor, propertyName, options: validationOptions,
    validator: {
      validate(value: unknown) {
        if (typeof value !== 'string') return false;
        if (!new RegExp(`^\\d+(\\.\\d{1,${opts.scale}})?$`).test(value)) return false;
        const n = Number(value);
        return n >= opts.min && n <= opts.max;
      },
      defaultMessage: () => `${propertyName} must be a number from ${opts.min} to ${opts.max} with at most ${opts.scale} decimal places.`,
    },
  });
}

/** data:image/… URL (or empty string to clear), at most ~1.5 MB. */
export function IsImageDataUrl(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => registerDecorator({
    name: 'isImageDataUrl', target: object.constructor, propertyName, options: validationOptions,
    validator: {
      validate: (value: unknown) => value === '' || value === null ||
        (typeof value === 'string' && /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(value) && value.length <= 1_500_000),
      defaultMessage: () => 'Invalid image (PNG/JPEG/GIF/WebP data URL, max ~1 MB).',
    },
  });
}

/** A real calendar date in YYYY-MM-DD form. */
export function IsIsoDay(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => registerDecorator({
    name: 'isIsoDay', target: object.constructor, propertyName, options: validationOptions,
    validator: { validate: (value: unknown) => isIsoDay(value), defaultMessage: () => `${propertyName} must be a valid date (YYYY-MM-DD).` },
  });
}
