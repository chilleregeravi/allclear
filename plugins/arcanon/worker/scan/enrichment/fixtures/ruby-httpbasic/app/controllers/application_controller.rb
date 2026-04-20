class ApplicationController < ActionController::Base
  before_action :authenticate

  private

  def authenticate
    authenticate_or_request_with_http_basic('Admin') do |u, p|
      u == 'admin' && p == 'secret'
    end
  end
end
