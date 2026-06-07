export const es = {
  // Menu
  menu_title: 'Feral Myth: Realms',
  menu_subtitle: 'El archipiélago te espera',
  btn_play_guest: 'Jugar como invitado',
  btn_login: 'Iniciar sesión',
  btn_register: 'Registrarse',
  btn_logout: 'Cerrar sesión',
  btn_play: 'Jugar',

  // Auth
  auth_email: 'Correo electrónico',
  auth_password: 'Contraseña',
  auth_username: 'Nombre de usuario',
  auth_login: 'Iniciar sesión',
  auth_register: 'Crear cuenta',
  auth_guest_alias: 'Tu alias de invitado',
  auth_enter_alias: 'Introduce tu alias',
  auth_back: 'Volver',
  auth_or: 'o',
  auth_error_empty: 'Por favor, rellena todos los campos',
  auth_error_short: 'El alias debe tener al menos 2 caracteres',
  auth_success: '¡Sesión iniciada!',
  auth_registered: '¡Cuenta creada!',
  auth_logged_as: 'Conectado como',
  auth_guest_as: 'Invitado como',

  // Class select
  class_select_title: 'Elige tu clase',
  class_stag_druid: 'Ciervo Druida',
  class_raven_witch: 'Cuervo Brujo',
  class_wolf_guardian: 'Lobo Guardián',
  class_fox_trickster: 'Zorro Ilusionista',
  class_role_support: 'Apoyo / Control',
  class_role_mage: 'Mago / Distancia',
  class_role_tank: 'Tanque / Melee',
  class_role_mobile: 'Movilidad / Engaño',
  btn_confirm_class: 'Confirmar clase',

  // Lobby
  lobby_title: 'Sala de reunión',
  btn_create_realm: 'Crear sala cooperativa',
  btn_join_realm: 'Unirse a sala cooperativa',
  btn_find_duel: 'Buscar duelo 1v1',
  btn_create_private: 'Sala privada',
  btn_join_code: 'Unirse con código',
  lobby_room_code: 'Código de sala',
  lobby_copy_code: 'Copiar código',
  lobby_copied: '¡Copiado!',
  lobby_enter_code: 'Introduce el código',
  lobby_join: 'Unirse',
  lobby_players: 'Jugadores conectados',
  lobby_waiting: 'Esperando jugadores...',
  lobby_friend_code: 'Tu código de amigo',
  lobby_available_rooms: 'Salas disponibles',
  lobby_no_rooms: 'No hay salas activas',

  // HUD
  hud_hp: 'Vida',
  hud_energy: 'Energía',
  hud_level: 'Nv.',
  hud_xp: 'XP',
  hud_respawn: 'Reapareciendo en',
  hud_ability_q: 'Q',
  hud_ability_e: 'E',
  hud_ability_r: 'R',
  hud_sanctuary: 'Santuario',
  hud_capturing: 'Capturando...',
  hud_captured: 'Capturado',

  // Game events
  event_kill: '¡Enemigo derrotado!',
  event_levelup: '¡Subiste de nivel!',
  event_sanctuary: 'Santuario capturado',
  event_died: 'Caíste en batalla',
  event_respawn: 'Reapareciendo...',

  // Results
  results_title: 'Resultado',
  results_winner: '¡Ganador!',
  results_draw: 'Empate',
  results_you_win: '¡Has ganado!',
  results_you_lose: 'Has perdido',
  results_xp_gained: 'XP obtenida',
  results_monsters: 'Monstruos derrotados',
  results_duration: 'Duración',
  btn_play_again: 'Jugar de nuevo',
  btn_main_menu: 'Menú principal',

  // Errors
  err_connection: 'Error de conexión con el servidor',
  err_room_not_found: 'Sala no encontrada',
  err_room_full: 'Sala llena',
  err_unknown: 'Error desconocido',

  // Controls hint
  controls_move: 'WASD / Flechas: mover',
  controls_attack: 'J / Clic: atacar',
  controls_abilities: 'Q E R: habilidades',
  controls_chat: 'T: chat',
};

export type I18nKeys = keyof typeof es;
