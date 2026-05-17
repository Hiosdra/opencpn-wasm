/**************************************************************************
 *   Copyright (C) 2015 by David S. Register                               *
 *                                                                         *
 *   This program is free software; you can redistribute it and/or modify  *
 *   it under the terms of the GNU General Public License as published by  *
 *   the Free Software Foundation; either version 2 of the License, or     *
 *   (at your option) any later version.                                   *
 *                                                                         *
 *   This program is distributed in the hope that it will be useful,       *
 *   but WITHOUT ANY WARRANTY; without even the implied warranty of        *
 *   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the         *
 *   GNU General Public License for more details.                          *
 *                                                                         *
 *   You should have received a copy of the GNU General Public License     *
 *   along with this program; if not, write to the                         *
 *   Free Software Foundation, Inc.,                                       *
 *   51 Franklin Street, Fifth Floor, Boston, MA 02110-1301,  USA.         *
 **************************************************************************/

/**
 * \file
 * TBD
 */

#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

#include "s57registrar_mgr.h"
#include "s57class_registrar.h"

extern S57ClassRegistrar* g_poRegistrar;

static std::vector<std::string> tokenize(const std::string& line, char delim) {
  std::vector<std::string> tokens;
  std::istringstream ss(line);
  std::string tok;
  while (std::getline(ss, tok, delim)) tokens.push_back(tok);
  return tokens;
}

static int s57_initialize(const std::string& csv_dir, FILE* flog) {
  if (g_poRegistrar == nullptr) {
    g_poRegistrar = new S57ClassRegistrar();
    if (!g_poRegistrar->LoadInfo(csv_dir.c_str(), 0)) {
      fprintf(stderr, "Error: Could not load S57 ClassInfo from %s\n",
              csv_dir.c_str());
      delete g_poRegistrar;
      g_poRegistrar = nullptr;
    }
  }
  return 0;
}

s57RegistrarMgr::s57RegistrarMgr(const std::string& csv_dir, FILE* flog) {
  s57_initialize(csv_dir, flog);
  s57_attr_init(csv_dir);
  s57_feature_init(csv_dir);
}

s57RegistrarMgr::~s57RegistrarMgr() {
  delete g_poRegistrar;
  g_poRegistrar = nullptr;
}

bool s57RegistrarMgr::s57_attr_init(const std::string& csv_dir) {
  std::string path = csv_dir;
  if (!path.empty() && path.back() != '/') path += '/';
  path += "s57attributes.csv";

  std::ifstream file(path);
  if (!file.is_open()) {
    fprintf(stderr, "Error: Could not load S57 Attribute Info from %s\n",
            csv_dir.c_str());
    return false;
  }

  std::string line;
  while (std::getline(file, line)) {
    auto tokens = tokenize(line, ',');
    if (tokens.size() < 3) continue;
    char* end = nullptr;
    long nID = strtol(tokens[0].c_str(), &end, 10);
    if (end != tokens[0].c_str()) {
      const std::string& acronym = tokens[2];
      m_attrHash1[acronym] = static_cast<int>(nID);
      m_attrHash2[static_cast<int>(nID)] = acronym;
    }
  }
  return true;
}

bool s57RegistrarMgr::s57_feature_init(const std::string& csv_dir) {
  std::string path = csv_dir;
  if (!path.empty() && path.back() != '/') path += '/';
  path += "s57objectclasses.csv";

  std::ifstream file(path);
  if (!file.is_open()) {
    fprintf(stderr, "Error: Could not load S57 Feature Info from %s\n",
            csv_dir.c_str());
    return false;
  }

  std::string line;
  while (std::getline(file, line)) {
    auto tokens = tokenize(line, ',');
    if (tokens.size() < 3) continue;
    char* end = nullptr;
    long nID = strtol(tokens[0].c_str(), &end, 10);
    if (end != tokens[0].c_str()) {
      // Description may contain commas inside quotes — skip to acronym
      // Find acronym: it's the first token after the quoted description
      size_t idx = 1;
      if (idx < tokens.size() && !tokens[idx].empty() &&
          tokens[idx].front() == '"') {
        // Skip tokens until we find one ending with quote
        while (idx < tokens.size() &&
               tokens[idx].back() != '"')
          idx++;
        idx++;  // move past the closing-quote token
      } else {
        idx++;  // simple description without quotes
      }
      if (idx < tokens.size()) {
        const std::string& acronym = tokens[idx];
        m_featureHash1[acronym] = static_cast<int>(nID);
        m_featureHash2[static_cast<int>(nID)] = acronym;
      }
    }
  }
  return true;
}

int s57RegistrarMgr::getAttributeID(const char* pAttrName) {
  std::string key(pAttrName);
  auto it = m_attrHash1.find(key);
  return (it != m_attrHash1.end()) ? it->second : -1;
}

std::string s57RegistrarMgr::getAttributeAcronym(int nID) {
  auto it = m_attrHash2.find(nID);
  return (it != m_attrHash2.end()) ? it->second : "";
}

std::string s57RegistrarMgr::getFeatureAcronym(int nID) {
  auto it = m_featureHash2.find(nID);
  return (it != m_featureHash2.end()) ? it->second : "";
}
