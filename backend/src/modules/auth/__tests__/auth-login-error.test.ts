import { describe, expect, it } from "vitest";
import { classifyLoginError } from "../auth-login-error.js";

describe("classifyLoginError", () => {
  it("keeps invalid credentials as an authentication failure", () => {
    expect(classifyLoginError(new Error("Invalid credentials"))).toEqual({
      status: 401,
      message: "Invalid credentials",
    });
  });

  it("maps connection saturation to a generic service-unavailable response", () => {
    const error = Object.assign(new Error("Too many connections"), {
      code: "ER_CON_COUNT_ERROR",
    });

    expect(classifyLoginError(error)).toEqual({
      status: 503,
      message: "Authentication service temporarily unavailable. Please try again shortly.",
    });
  });

  it("does not expose authentication schema errors", () => {
    const error = Object.assign(new Error("Unknown column 'failed_login_attempts'"), {
      code: "ER_BAD_FIELD_ERROR",
    });

    expect(classifyLoginError(error)).toEqual({
      status: 503,
      message: "Authentication service temporarily unavailable. Please try again shortly.",
    });
  });
});
