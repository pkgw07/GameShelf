import { clsx, type ClassValue } from 'clsx'

/** 조건부 클래스 합치기. 같은 속성을 덮어써야 할 때는 호출하는 쪽에서 하나만 넣는다 */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs)
}
