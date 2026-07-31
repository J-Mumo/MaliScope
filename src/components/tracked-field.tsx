"use client";

import type { InputStatus, TrackedInput } from "@/domain";

interface TrackedFieldProps<T extends string | number> {
  label: string;
  input: TrackedInput<T>;
  onChange: (next: TrackedInput<T>) => void;
  type?: "number" | "text";
  step?: string;
  min?: string;
  suffix?: string;
  serializeAsNumber?: boolean;
}

export function TrackedField<T extends string | number>({
  label,
  input,
  onChange,
  type = "number",
  step = "any",
  min = "0",
  suffix,
  serializeAsNumber = false,
}: TrackedFieldProps<T>) {
  const setStatus = (status: InputStatus) => {
    if (status === "missing") {
      onChange({ ...input, status, value: null });
      return;
    }

    onChange({
      ...input,
      status,
      value: input.value,
    });
  };

  return (
    <label className="tracked-field">
      <span className="field-label">{label}</span>
      <span className="input-row">
        <input
          aria-label={label}
          type={type}
          step={type === "number" ? step : undefined}
          min={type === "number" ? min : undefined}
          value={input.value ?? ""}
          disabled={input.status === "missing"}
          onChange={(event) => {
            const raw = event.target.value;
            if (raw === "") {
              onChange({ ...input, value: null, status: "missing" });
              return;
            }
            onChange({
              ...input,
              value: (serializeAsNumber ? Number(raw) : raw) as T,
            });
          }}
        />
        {suffix ? <span className="suffix">{suffix}</span> : null}
        <select
          aria-label={`${label} provenance`}
          value={input.status}
          onChange={(event) => setStatus(event.target.value as InputStatus)}
          className={`status status-${input.status}`}
        >
          <option value="reported">reported</option>
          <option value="estimated">estimated</option>
          <option value="missing">missing</option>
        </select>
      </span>
      {input.note ? <small>{input.note}</small> : null}
    </label>
  );
}
