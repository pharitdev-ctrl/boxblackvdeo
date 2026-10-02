/**
 * A render stopped by the machine, not by what was rendered: for a graphic, the renderer pack missing or damaged, or
 * its browser not starting; the app's ffmpeg or ffprobe missing, its motion host missing, a font that cannot be
 * copied; a work folder that cannot be prepared, a graphics folder the result cannot be kept in. For a sound, the
 * app's ffmpeg missing or not starting, the sealed page not starting, a sounds folder that cannot be written, or the
 * app quitting. Nothing renders until that is put right, and nothing rendered is to blame for it.
 */
export class EnvironmentError extends Error {}
