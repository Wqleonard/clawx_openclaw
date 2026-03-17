import type { BrowserWindow } from 'electron';
import type { GatewayManager } from '../gateway/manager';
import type { ClawHubService } from '../gateway/clawhub';
import type { SkillHubService } from '../services/skillhub-service';
import type { HostEventBus } from './event-bus';

export interface HostApiContext {
  gatewayManager: GatewayManager;
  clawHubService: ClawHubService;
  skillHubService: SkillHubService;
  eventBus: HostEventBus;
  mainWindow: BrowserWindow | null;
}
