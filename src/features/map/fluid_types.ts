export interface WeatherData {
  temp: number | null
  precip: number
  windSpeed: number
  windDir: number
  soil: number | null
  precip24: number
}

export interface FluidData {
  elevations: number[]
  weather: WeatherData
  riskScore: number       // 0–1
  riskLabel: 'Low' | 'Moderate' | 'High' | 'Critical'
}