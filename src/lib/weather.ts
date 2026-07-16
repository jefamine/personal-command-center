export interface WeatherDay {
  date: string;
  code: number;
  max: number;
  min: number;
  rainChance: number;
}

export interface WeatherSnapshot {
  temperature: number;
  apparentTemperature: number;
  code: number;
  windSpeed: number;
  days: WeatherDay[];
  fetchedAt: string;
}

export interface CityMatch {
  name: string;
  country: string;
  latitude: number;
  longitude: number;
}

export function weatherLabel(code: number) {
  if (code === 0) return "Ясно";
  if (code <= 3) return "Переменная облачность";
  if (code === 45 || code === 48) return "Туман";
  if (code >= 51 && code <= 57) return "Морось";
  if (code >= 61 && code <= 67) return "Дождь";
  if (code >= 71 && code <= 77) return "Снег";
  if (code >= 80 && code <= 82) return "Ливни";
  if (code >= 85 && code <= 86) return "Снегопад";
  if (code >= 95) return "Гроза";
  return "Без осадков";
}

export async function searchCity(name: string): Promise<CityMatch | null> {
  const query = new URLSearchParams({ name: name.trim(), count: "1", language: "ru", format: "json" });
  const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${query}`);
  if (!response.ok) throw new Error("Не удалось найти город.");
  const data = await response.json() as {
    results?: Array<{ name: string; country?: string; latitude: number; longitude: number }>;
  };
  const match = data.results?.[0];
  return match ? {
    name: match.name,
    country: match.country ?? "",
    latitude: match.latitude,
    longitude: match.longitude
  } : null;
}

export async function loadWeather(latitude: number, longitude: number): Promise<WeatherSnapshot> {
  const cacheKey = `command-center-weather:${latitude.toFixed(2)}:${longitude.toFixed(2)}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as WeatherSnapshot;
      if (Date.now() - new Date(parsed.fetchedAt).getTime() < 60 * 60 * 1000) return parsed;
    } catch {
      localStorage.removeItem(cacheKey);
    }
  }

  const query = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: "temperature_2m,apparent_temperature,weather_code,wind_speed_10m",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    timezone: "auto",
    forecast_days: "3"
  });
  try {
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${query}`);
    if (!response.ok) throw new Error("Сервис погоды временно недоступен.");
    const data = await response.json() as {
      current: { temperature_2m: number; apparent_temperature: number; weather_code: number; wind_speed_10m: number };
      daily: {
        time: string[];
        weather_code: number[];
        temperature_2m_max: number[];
        temperature_2m_min: number[];
        precipitation_probability_max: number[];
      };
    };
    const snapshot: WeatherSnapshot = {
      temperature: data.current.temperature_2m,
      apparentTemperature: data.current.apparent_temperature,
      code: data.current.weather_code,
      windSpeed: data.current.wind_speed_10m,
      days: data.daily.time.map((date, index) => ({
        date,
        code: data.daily.weather_code[index],
        max: data.daily.temperature_2m_max[index],
        min: data.daily.temperature_2m_min[index],
        rainChance: data.daily.precipitation_probability_max[index]
      })),
      fetchedAt: new Date().toISOString()
    };
    localStorage.setItem(cacheKey, JSON.stringify(snapshot));
    return snapshot;
  } catch (error) {
    if (cached) return JSON.parse(cached) as WeatherSnapshot;
    throw new Error(
      error instanceof Error && error.message === "Сервис погоды временно недоступен."
        ? error.message
        : "Не удалось загрузить прогноз. Проверьте подключение к интернету."
    );
  }
}
