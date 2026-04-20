package com.example;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;

@EnableWebSecurity
public class SecurityConfig {
  // Spring Security 5 style — no SecurityFilterChain bean
  // @PreAuthorize used on service methods
}
