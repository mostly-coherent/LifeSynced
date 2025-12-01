declare module 'ical.js' {
  export function parse(input: string): any[]
  
  export class Component {
    constructor(jcal: any[] | string, parent?: Component)
    getAllSubcomponents(name?: string): Component[]
    getFirstSubcomponent(name?: string): Component | null
    getFirstPropertyValue(name: string): any
  }
  
  export class Event {
    constructor(component?: Component, options?: any)
    readonly uid: string
    readonly summary: string
    readonly description: string
    readonly location: string
    readonly startDate: Time | null
    readonly endDate: Time | null
    readonly duration: Duration | null
    readonly organizer: string | null
    isRecurring(): boolean
    iterator(startTime?: Time): RecurExpansion
  }
  
  export class Time {
    constructor(data?: any)
    toJSDate(): Date
    readonly isDate: boolean
  }
  
  export class Duration {
    toSeconds(): number
  }
  
  export class RecurExpansion {
    next(): Time | null
  }
}

