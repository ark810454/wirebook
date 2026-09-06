export type DeviceType = 'iphone' | 'android' | 'desktop' | 'tablet' | 'custom'
export type ElementType = 'path' | 'rectangle' | 'circle' | 'line' | 'arrow' | 'text' | 'stickyNote' | 'svg' | 'image'

export interface Project { id: string; name: string; description: string; deviceType: DeviceType; createdAt: number; updatedAt: number; favorite: boolean; deletedAt?: number }
export interface Screen { id: string; projectId: string; name: string; deviceType: DeviceType; width: number; height: number; createdAt: number; updatedAt: number }
export interface CanvasElement { id: string; screenId: string; type: ElementType; data: Record<string, unknown>; createdAt: number; updatedAt: number }
