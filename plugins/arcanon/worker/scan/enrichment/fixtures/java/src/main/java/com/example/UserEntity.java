package com.example;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import org.springframework.jdbc.core.JdbcTemplate;
// PostgreSQL driver on classpath: org.postgresql.Driver
// datasource: jdbc:postgresql://localhost:5432/demo

@Entity
public class UserEntity {
  @Id
  private Long id;
  // JdbcTemplate reference in comment: JdbcTemplate
}
